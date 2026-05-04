import test from 'node:test';
import assert from 'node:assert/strict';

import { pollOnce } from '../src/workers/paymentsWorker.js';

function testConfig() {
  return {
    tonNetwork: 'testnet',
    paymentReceiverWalletAddress: '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    tonIndexerUrl: 'https://testnet.tonapi.io/v2'
  };
}

function captureLogger() {
  const entries = [];
  const write = (line) => entries.push(JSON.parse(line));
  return {
    entries,
    info: write,
    warn: write,
    error: write
  };
}

test('payments worker credits valid payment and ignores invalid mocked indexer transactions', async () => {
  const logger = captureLogger();
  const reasons = [
    null,
    'wrong_receiver',
    'wrong_amount',
    'wrong_payload',
    'wrong_sender',
    'duplicate_tx_hash',
    'order_already_paid',
    'order_expired'
  ];
  const calls = [];
  let writtenCheckpoint = null;

  const result = await pollOnce({
    db: {},
    config: testConfig(),
    logger,
    runId: 'worker-run-1',
    now: new Date('2026-04-27T12:00:00.000Z'),
    sleepFn: async () => {},
    readCheckpoint: async () => ({ lastSeenLt: '10' }),
    writeCheckpoint: async (_db, input) => {
      writtenCheckpoint = input.cursor;
    },
    fetchTransactions: async ({ cursor }) => {
      calls.push(['fetch', cursor]);
      return {
        transactions: reasons.map((reason, index) => ({ reason, hash: `tx_${index}` })),
        cursor: { lastSeenLt: '18' }
      };
    },
    service: {
      async creditIncomingTransaction({ rawTx }) {
        if (rawTx.reason === null) {
          return {
            credited: true,
            order: { orderId: 'order_1' },
            payment: { txHash: rawTx.hash }
          };
        }
        return { credited: false, reason: rawTx.reason };
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.processed, 8);
  assert.equal(result.credited, 1);
  assert.equal(result.ignored, 7);
  assert.equal(result.checkpointWritten, true);
  assert.deepEqual(writtenCheckpoint, { lastSeenLt: '18' });
  assert.equal(calls[0][1].lastSeenLt, '10');
  assert.equal(logger.entries.some((entry) => entry.event === 'payment_worker_credit_success'), true);
  assert.equal(logger.entries.some((entry) => entry.event === 'payment_worker_credit_ignored' && entry.reason === 'wrong_receiver'), true);
  assert.equal(logger.entries.every((entry) => entry.runId === 'worker-run-1'), true);
});

test('payments worker retries indexer errors and does not advance checkpoint after failure', async () => {
  const logger = captureLogger();
  let attempts = 0;
  let checkpointWrites = 0;

  const result = await pollOnce({
    db: {},
    config: testConfig(),
    logger,
    runId: 'worker-run-indexer-fail',
    maxRetries: 2,
    baseBackoffMs: 1,
    sleepFn: async () => {},
    readCheckpoint: async () => ({ lastSeenLt: '10' }),
    writeCheckpoint: async () => {
      checkpointWrites += 1;
    },
    fetchTransactions: async () => {
      attempts += 1;
      throw new Error('indexer unavailable');
    },
    service: {
      async creditIncomingTransaction() {
        throw new Error('should not process without indexer data');
      }
    }
  });

  assert.equal(attempts, 3);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'indexer_error');
  assert.equal(result.checkpointWritten, false);
  assert.equal(checkpointWrites, 0);
  assert.equal(logger.entries.filter((entry) => entry.event === 'payment_worker_indexer_retry').length, 2);
  assert.equal(logger.entries.some((entry) => entry.event === 'payment_worker_indexer_failed'), true);
});

test('payments worker skips checkpoint when transaction processing throws', async () => {
  const logger = captureLogger();
  let checkpointWrites = 0;

  const result = await pollOnce({
    db: {},
    config: testConfig(),
    logger,
    runId: 'worker-run-processing-fail',
    sleepFn: async () => {},
    readCheckpoint: async () => null,
    writeCheckpoint: async () => {
      checkpointWrites += 1;
    },
    fetchTransactions: async () => ({
      transactions: [{ hash: 'tx_ok' }, { hash: 'tx_boom' }],
      cursor: { lastSeenLt: '20' }
    }),
    service: {
      async creditIncomingTransaction({ rawTx }) {
        if (rawTx.hash === 'tx_boom') throw new Error('db unavailable');
        return {
          credited: true,
          order: { orderId: 'order_ok' },
          payment: { txHash: rawTx.hash }
        };
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'processing_error');
  assert.equal(result.checkpointWritten, false);
  assert.equal(checkpointWrites, 0);
  assert.equal(logger.entries.some((entry) => entry.event === 'payment_worker_checkpoint_skipped'), true);
});
