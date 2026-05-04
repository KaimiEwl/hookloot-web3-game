import test from 'node:test';
import assert from 'node:assert/strict';
import { Address } from '@ton/ton';

import {
  ASSET_TYPES,
  TON_CHAIN_IDS,
  buildTonConnectTransaction,
  getPaymentCatalogItem,
  tonToNanoUnits
} from '../src/payments/catalog.js';
import {
  convertAssetAmountToUnits,
  normalizeIncomingPaymentTransaction,
  sameWalletAddress,
  validateIncomingPayment
} from '../src/payments/transactions.js';
import { fetchIncomingTransactions } from '../src/payments/indexer.js';

const order = {
  orderId: 'order_1',
  itemId: 'nft_card:common',
  expectedAmountUnits: tonToNanoUnits('5'),
  assetType: ASSET_TYPES.TON,
  jettonContract: null,
  receiverWallet: '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  payload: 'nft-miner:testnet:order_1',
  status: 'pending',
  expiresAt: new Date(Date.now() + 60_000)
};

function tx(overrides = {}) {
  return {
    txHash: 'tx_1',
    senderWallet: '0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    receiverWallet: order.receiverWallet,
    assetType: ASSET_TYPES.TON,
    jettonContract: null,
    amountUnits: order.expectedAmountUnits,
    payload: order.payload,
    ...overrides
  };
}

test('payment catalog defines server-side NFT and TON boost prices', () => {
  const common = getPaymentCatalogItem('nft_card:common');
  const boost = getPaymentCatalogItem('ton-boost-x5');

  assert.equal(common.assetType, 'TON');
  assert.equal(common.expectedAmountUnits.toString(), '5000000000');
  assert.equal(common.grant.type, 'nft');
  assert.equal(common.grant.rarityId, 'common');

  assert.equal(boost.expectedAmountUnits.toString(), '5000000000');
  assert.equal(boost.grant.type, 'ton_boost');
  assert.equal(boost.grant.multiplier, 5);
});

test('TON Connect transaction is server-prepared and testnet by default', () => {
  const transaction = buildTonConnectTransaction({ order, network: 'testnet' });
  assert.equal(transaction.network, TON_CHAIN_IDS.testnet);
  assert.equal(transaction.messages[0].address, order.receiverWallet);
  assert.equal(transaction.messages[0].amount, order.expectedAmountUnits.toString());
  assert.equal(typeof transaction.messages[0].payload, 'string');
  assert.ok(transaction.messages[0].payload.length > 0);
});

test('incoming payment validation rejects forged tx details', () => {
  const linkedWalletAddress = tx().senderWallet;
  assert.equal(validateIncomingPayment({ order, tx: tx(), linkedWalletAddress }).ok, true);
  assert.equal(validateIncomingPayment({ order, tx: tx({ amountUnits: 1n }), linkedWalletAddress }).reason, 'wrong_amount');
  assert.equal(validateIncomingPayment({ order, tx: tx({ receiverWallet: '0:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }), linkedWalletAddress }).reason, 'wrong_receiver');
  assert.equal(validateIncomingPayment({ order, tx: tx({ payload: 'fake' }), linkedWalletAddress }).reason, 'wrong_payload');
  assert.equal(validateIncomingPayment({ order, tx: tx({ assetType: 'JETTON' }), linkedWalletAddress }).reason, 'wrong_asset');
  assert.equal(validateIncomingPayment({ order, tx: tx({ senderWallet: '0:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' }), linkedWalletAddress }).reason, 'wrong_sender');
});

test('incoming payment validation keeps paid and expired order lifecycle closed', () => {
  const linkedWalletAddress = tx().senderWallet;
  assert.equal(validateIncomingPayment({
    order: { ...order, status: 'paid' },
    tx: tx(),
    linkedWalletAddress
  }).reason, 'order_paid');
  assert.equal(validateIncomingPayment({
    order: { ...order, expiresAt: new Date(Date.now() - 1_000) },
    tx: tx(),
    linkedWalletAddress,
    now: new Date()
  }).reason, 'order_expired');
});

test('TON wallet comparison normalizes raw and user-friendly address formats', () => {
  const raw = '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const friendly = Address.parse(raw).toString({ bounceable: false, urlSafe: true });

  assert.equal(sameWalletAddress(raw, friendly), true);
  assert.equal(sameWalletAddress('EQ_FAKE_FOR_FALLBACK', 'eq_fake_for_fallback'), true);
});

test('jetton decimals are handled without assuming nine decimals', () => {
  assert.equal(convertAssetAmountToUnits('1.23', 6).toString(), '1230000');
  assert.equal(convertAssetAmountToUnits('1.23', 9).toString(), '1230000000');
});

test('incoming transaction normalizer supports common indexer shapes', () => {
  const normalized = normalizeIncomingPaymentTransaction({
    hash: 'hash_1',
    lt: '42',
    in_msg: {
      source: tx().senderWallet,
      destination: order.receiverWallet,
      value: order.expectedAmountUnits.toString(),
      comment: order.payload
    }
  });

  assert.equal(normalized.txHash, 'hash_1');
  assert.equal(normalized.txLt, '42');
  assert.equal(normalized.amountUnits, order.expectedAmountUnits);
  assert.equal(normalized.payload, order.payload);
});

test('payment indexer uses latest lt checkpoint instead of rescanning old transactions', async () => {
  const response = await fetchIncomingTransactions({
    config: {
      tonIndexerUrl: 'https://testnet.tonapi.io/v2',
      tonIndexerApiKey: ''
    },
    receiverWallet: order.receiverWallet,
    cursor: { lastSeenLt: '100' },
    fetchImpl: async (url) => {
      assert.equal(url.searchParams.has('before_lt'), false);
      return {
        ok: true,
        async json() {
          return {
            transactions: [
              { lt: '120', hash: 'new_tx' },
              { lt: '99', hash: 'old_tx' }
            ]
          };
        }
      };
    }
  });

  assert.equal(response.transactions.length, 1);
  assert.equal(response.transactions[0].hash, 'new_tx');
  assert.equal(response.cursor.lastSeenLt, '120');
});
