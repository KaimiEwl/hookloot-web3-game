import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { signSessionToken } from '../src/auth/jwt.js';
import { ActionError } from '../src/lib/actionErrors.js';

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3101',
    PUBLIC_APP_ORIGIN: 'https://demo.example.com',
    TON_PROOF_DOMAIN: 'demo.example.com',
    JWT_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    TON_NETWORK: 'testnet',
    PAYMENT_RECEIVER_WALLET_ADDRESS: '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });
}

function testConfigWithoutReceiver() {
  return loadConfig({
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3101',
    PUBLIC_APP_ORIGIN: 'https://demo.example.com',
    TON_PROOF_DOMAIN: 'demo.example.com',
    JWT_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    TON_NETWORK: 'testnet',
    PAYMENT_RECEIVER_WALLET_ADDRESS: ''
  });
}

function fakeRedis() {
  return {
    async set() { return 'OK'; },
    async get() { return null; },
    async del() { return 0; },
    async quit() { return 'OK'; }
  };
}

async function authHeader(config) {
  const { token } = await signSessionToken({
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    walletAddress: '0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    config,
    now: new Date()
  });
  return `Bearer ${token}`;
}

test('payment runtime status exposes configured false without secrets when receiver is missing', async () => {
  const config = testConfigWithoutReceiver();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    paymentsService: {},
    gameService: {
      async getState() { return {}; },
      async sync() { return {}; }
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/payments/status'
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.configured, false);
  assert.equal(body.data.ready, false);
  assert.equal(body.data.receiverWalletConfigured, false);
  assert.equal('paymentReceiverWalletAddress' in body.data, false);

  await app.close();
});

test('mainnet payment config fails fast without receiver wallet', () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3101',
    PUBLIC_APP_ORIGIN: 'https://demo.example.com',
    TON_PROOF_DOMAIN: 'demo.example.com',
    JWT_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    TON_NETWORK: 'mainnet',
    PAYMENT_RECEIVER_WALLET_ADDRESS: ''
  }), /PAYMENT_RECEIVER_WALLET_ADDRESS/);
});

test('payment order and withdrawal routes require auth/idempotency and pass only intent', async () => {
  const config = testConfig();
  const calls = [];
  const paymentsService = {
    async createOrder(input) {
      calls.push(['createOrder', input]);
      return {
        order: {
          orderId: 'order_1',
          itemId: input.itemId,
          status: 'pending',
          expectedAmountUnits: '5000000000',
          assetType: 'TON',
          receiverWallet: config.paymentReceiverWalletAddress,
          payload: 'nft-miner:testnet:order_1',
          expiresAt: '2026-04-27T12:15:00.000Z'
        },
        transaction: {
          validUntil: 1777313700,
          network: '-3',
          messages: [{ address: config.paymentReceiverWalletAddress, amount: '5000000000', payload: 'cell' }]
        },
        expiresAt: '2026-04-27T12:15:00.000Z'
      };
    },
    async getOrder(input) {
      calls.push(['getOrder', input]);
      return { order: { orderId: input.orderId, status: 'pending' }, payments: [] };
    },
    async createWithdrawal(input) {
      calls.push(['createWithdrawal', input]);
      return { withdrawal: { id: 'withdrawal_1', status: 'pending', amountUnits: input.amountUnits } };
    }
  };
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    paymentsService,
    gameService: {
      async getState() { return {}; },
      async sync() { return {}; }
    }
  });
  const authorization = await authHeader(config);

  const statusResponse = await app.inject({
    method: 'GET',
    url: '/api/payments/status'
  });
  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.json().data.ready, true);
  assert.equal(statusResponse.json().data.network, 'testnet');

  const missingKey = await app.inject({
    method: 'POST',
    url: '/api/payments/orders',
    headers: { authorization },
    payload: { itemId: 'nft_card:common' }
  });
  assert.equal(missingKey.statusCode, 400);
  assert.equal(missingKey.json().error.code, 'missing_idempotency_key');

  const rejectedClientPaymentDetails = await app.inject({
    method: 'POST',
    url: '/api/payments/orders',
    headers: { authorization, 'idempotency-key': 'pay-common-0001' },
    payload: { itemId: 'nft_card:common', amount: '1', receiverWallet: 'fake' }
  });
  assert.equal(rejectedClientPaymentDetails.statusCode, 400);
  assert.equal(rejectedClientPaymentDetails.json().error.code, 'validation_error');

  const orderResponse = await app.inject({
    method: 'POST',
    url: '/api/payments/orders',
    headers: { authorization, 'idempotency-key': 'pay-common-0002' },
    payload: { itemId: 'nft_card:common' }
  });
  assert.equal(orderResponse.statusCode, 200);
  assert.equal(orderResponse.json().data.order.status, 'pending');
  assert.equal(orderResponse.json().data.transaction.messages[0].amount, '5000000000');

  const getResponse = await app.inject({
    method: 'GET',
    url: '/api/payments/orders/order_1',
    headers: { authorization }
  });
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json().data.order.orderId, 'order_1');

  const withdrawalResponse = await app.inject({
    method: 'POST',
    url: '/api/withdrawals',
    headers: { authorization, 'idempotency-key': 'withdraw-0001' },
    payload: {
      amountUnits: '1000000000',
      assetType: 'TON',
      destinationWallet: '0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    }
  });
  assert.equal(withdrawalResponse.statusCode, 200);
  assert.equal(withdrawalResponse.json().data.withdrawal.status, 'pending');

  assert.equal(calls[0][0], 'createOrder');
  assert.equal(calls[0][1].itemId, 'nft_card:common');
  assert.equal(calls[0][1].walletAddress, '0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(calls[0][1].idempotency.key, 'pay-common-0002');
  assert.equal('amount' in calls[0][1], false);
  assert.equal('receiverWallet' in calls[0][1], false);
  assert.equal(calls[2][0], 'createWithdrawal');
  assert.equal(calls[2][1].amountUnits, '1000000000');

  await app.close();
});

test('payment routes return action errors in API envelope', async () => {
  const config = testConfig();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    paymentsService: {
      async createOrder() {
        throw new ActionError('payment_receiver_not_configured', 'Payment receiver wallet is not configured', {
          statusCode: 503
        });
      }
    },
    gameService: {
      async getState() { return {}; },
      async sync() { return {}; }
    }
  });
  const authorization = await authHeader(config);

  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/orders',
    headers: { authorization, 'idempotency-key': 'pay-common-0003' },
    payload: { itemId: 'nft_card:common' }
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().error.code, 'payment_receiver_not_configured');

  await app.close();
});
