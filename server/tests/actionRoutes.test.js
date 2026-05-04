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
    MINING_MAX_OFFLINE_SECONDS: '86400',
    MINING_PERSIST_INTERVAL_SECONDS: '30'
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
    walletAddress: 'EQ_TEST',
    config,
    now: new Date()
  });
  return `Bearer ${token}`;
}

function fakeActionState(balanceUnits = '0') {
  return {
    action: { type: 'test' },
    state: {
      balance: { units: balanceUnits, coins: '0' },
      balanceUnits,
      inventory: [],
      activeSlots: { slots: [], counts: {} },
      boosts: [],
      incomePerHour: { units: '0', coins: '0' },
      incomePerHourUnits: '0',
      serverTime: '2026-04-27T12:00:00.000Z',
      lastMinedAt: '2026-04-27T12:00:00.000Z'
    }
  };
}

test('server action routes require idempotency and pass only intent to service', async () => {
  const config = testConfig();
  const calls = [];
  const gameService = {
    async buyShopItem(input) {
      calls.push(['buyShopItem', input]);
      return fakeActionState('5000000');
    },
    async activateSlot(input) {
      calls.push(['activateSlot', input]);
      return fakeActionState();
    },
    async removeSlot(input) {
      calls.push(['removeSlot', input]);
      return fakeActionState();
    },
    async activateCoinBoost(input) {
      calls.push(['activateCoinBoost', input]);
      return fakeActionState();
    },
    async activateNftBoost(input) {
      calls.push(['activateNftBoost', input]);
      return fakeActionState();
    },
    async getState() { return fakeActionState().state; },
    async sync() { return fakeActionState().state; }
  };
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    gameService
  });
  const authorization = await authHeader(config);

  const missingKey = await app.inject({
    method: 'POST',
    url: '/api/shop/buy',
    headers: { authorization },
    payload: { itemId: 'nft_card', rarityId: 'common' }
  });
  assert.equal(missingKey.statusCode, 400);
  assert.equal(missingKey.json().error.code, 'missing_idempotency_key');

  const rejectedClientEconomy = await app.inject({
    method: 'POST',
    url: '/api/shop/buy',
    headers: { authorization, 'idempotency-key': 'buy-common-0001' },
    payload: { itemId: 'nft_card', rarityId: 'common', cost: 1 }
  });
  assert.equal(rejectedClientEconomy.statusCode, 400);
  assert.equal(rejectedClientEconomy.json().error.code, 'validation_error');

  const requests = [
    ['POST', '/api/shop/buy', 'buy-common-0002', { itemId: 'nft_card', rarityId: 'common' }],
    ['POST', '/api/inventory/activate-slot', 'slot-common-0001', { itemId: 'nft_card', rarityId: 'common', slotIndex: 0 }],
    ['POST', '/api/inventory/remove-slot', 'slot-remove-0001', { slotIndex: 0 }],
    ['POST', '/api/boosts/coin/activate', 'coin-boost-0001', {}],
    ['POST', '/api/boosts/nft/activate', 'nft-boost-0001', { rarityId: 'rare' }]
  ];

  for (const [method, url, key, payload] of requests) {
    const response = await app.inject({
      method,
      url,
      headers: { authorization, 'idempotency-key': key },
      payload
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.state.balanceUnits !== undefined, true);
  }

  assert.equal(calls.length, 5);
  assert.equal(calls[0][0], 'buyShopItem');
  assert.equal(calls[0][1].itemId, 'nft_card');
  assert.equal(calls[0][1].rarityId, 'common');
  assert.equal(calls[0][1].idempotency.key, 'buy-common-0002');
  assert.equal(calls[1][1].slotIndex, 0);
  assert.equal(calls[4][1].rarityId, 'rare');

  await app.close();
});

test('server action routes return action errors as envelope errors', async () => {
  const config = testConfig();
  const gameService = {
    async buyShopItem() {
      throw new ActionError('insufficient_balance', 'Not enough coins', {
        statusCode: 409,
        details: { requiredUnits: '5000000' }
      });
    },
    async getState() { return fakeActionState().state; },
    async sync() { return fakeActionState().state; }
  };
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    gameService
  });
  const authorization = await authHeader(config);

  const response = await app.inject({
    method: 'POST',
    url: '/api/shop/buy',
    headers: { authorization, 'idempotency-key': 'buy-common-0003' },
    payload: { itemId: 'nft_card', rarityId: 'common' }
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().error.code, 'insufficient_balance');
  assert.equal(response.json().error.details.requiredUnits, '5000000');

  await app.close();
});
