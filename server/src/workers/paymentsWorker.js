import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { createPaymentsService } from '../payments/service.js';
import {
  fetchIncomingTransactions,
  readPaymentCheckpoint,
  writePaymentCheckpoint
} from '../payments/indexer.js';
import { getPaymentsRuntimeStatus } from '../payments/readiness.js';
import { updatePaymentWorkerStatus } from '../payments/workerStatus.js';

function shouldRunOnce() {
  return process.argv.includes('--once') || process.env.WORKER_ONCE === '1';
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || 'Unknown error'
  };
}

function logWorker(logger, level, event, data = {}) {
  const entry = {
    level,
    event,
    worker: 'payments',
    ...data,
    at: new Date().toISOString()
  };
  const writer = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : console.log;
  writer(JSON.stringify(entry));
}

async function retryFetchTransactions({
  fetchTransactions,
  config,
  receiverWallet,
  cursor,
  logger,
  runId,
  maxRetries,
  baseBackoffMs,
  sleepFn
}) {
  let attempt = 0;
  while (true) {
    try {
      return await fetchTransactions({ config, receiverWallet, cursor });
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetries) {
        logWorker(logger, 'error', 'payment_worker_indexer_failed', {
          runId,
          attempt,
          error: safeError(error)
        });
        throw error;
      }

      const delayMs = baseBackoffMs * (2 ** (attempt - 1));
      logWorker(logger, 'warn', 'payment_worker_indexer_retry', {
        runId,
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        error: safeError(error)
      });
      await sleepFn(delayMs);
    }
  }
}

async function writeWorkerStatus(statusStore, patch) {
  if (typeof statusStore === 'function') {
    await statusStore(patch);
  }
}

export async function pollOnce({
  db,
  service,
  config,
  fetchTransactions = fetchIncomingTransactions,
  readCheckpoint = readPaymentCheckpoint,
  writeCheckpoint = writePaymentCheckpoint,
  logger = console,
  runId = randomUUID(),
  now = new Date(),
  maxRetries = 3,
  baseBackoffMs = 500,
  sleepFn = sleep,
  statusStore = null
}) {
  const receiverWallet = String(config.paymentReceiverWalletAddress || '').trim();
  const cursor = await readCheckpoint(db, {
    network: config.tonNetwork,
    receiverWallet
  });
  logWorker(logger, 'info', 'payment_worker_poll_start', {
    runId,
    network: config.tonNetwork,
    hasCheckpoint: Boolean(cursor)
  });
  await writeWorkerStatus(statusStore, {
    status: 'running',
    runId,
    incrementRunsBy: 1,
    lastRunAt: now.toISOString()
  });

  let response;
  try {
    response = await retryFetchTransactions({
      fetchTransactions,
      config,
      receiverWallet,
      cursor,
      logger,
      runId,
      maxRetries,
      baseBackoffMs,
      sleepFn
    });
  } catch (error) {
    await writeWorkerStatus(statusStore, {
      status: 'error',
      runId,
      incrementErrorsBy: 1,
      lastError: 'indexer_error'
    });
    logWorker(logger, 'error', 'payment_worker_poll_done', {
      runId,
      status: 'error',
      reason: 'indexer_error',
      processed: 0,
      credited: 0,
      ignored: 0,
      checkpointWritten: false
    });
    return {
      ok: false,
      reason: 'indexer_error',
      runId,
      processed: 0,
      credited: 0,
      ignored: 0,
      checkpointWritten: false
    };
  }

  let credited = 0;
  let ignored = 0;
  let processingFailed = false;
  for (const rawTx of response.transactions) {
    try {
      const result = await service.creditIncomingTransaction({ rawTx, now });
      if (result.credited) {
        credited += 1;
        logWorker(logger, 'info', 'payment_worker_credit_success', {
          runId,
          orderId: result.order?.orderId || null,
          txHash: result.payment?.txHash || null
        });
      } else {
        ignored += 1;
        logWorker(logger, 'info', 'payment_worker_credit_ignored', {
          runId,
          reason: result.reason || 'not_credited'
        });
      }
    } catch (error) {
      processingFailed = true;
      logWorker(logger, 'error', 'payment_worker_credit_failed', {
        runId,
        error: safeError(error)
      });
    }
  }

  if (processingFailed) {
    logWorker(logger, 'warn', 'payment_worker_checkpoint_skipped', {
      runId,
      reason: 'processing_error'
    });
    await writeWorkerStatus(statusStore, {
      status: 'error',
      runId,
      incrementErrorsBy: 1,
      lastError: 'processing_error'
    });
    logWorker(logger, 'error', 'payment_worker_poll_done', {
      runId,
      status: 'error',
      reason: 'processing_error',
      processed: response.transactions.length,
      credited,
      ignored,
      checkpointWritten: false
    });
    return {
      ok: false,
      reason: 'processing_error',
      runId,
      processed: response.transactions.length,
      credited,
      ignored,
      checkpointWritten: false
    };
  }

  if (response.cursor) {
    await writeCheckpoint(db, {
      network: config.tonNetwork,
      receiverWallet,
      cursor: response.cursor
    });
  }

  logWorker(logger, 'info', 'payment_worker_poll_done', {
    runId,
    status: 'ok',
    processed: response.transactions.length,
    credited,
    ignored,
    checkpointWritten: Boolean(response.cursor)
  });
  await writeWorkerStatus(statusStore, {
    status: 'ok',
    runId,
    lastSuccessAt: now.toISOString(),
    lastCheckpoint: response.cursor || null,
    lastError: null
  });

  return {
    ok: true,
    reason: null,
    runId,
    processed: response.transactions.length,
    credited,
    ignored,
    checkpointWritten: Boolean(response.cursor)
  };
}

async function main() {
  const config = loadConfig();
  const status = getPaymentsRuntimeStatus(config);
  if (!status.ready) {
    console.warn('TON payments worker is not ready; configure PAYMENT_RECEIVER_WALLET_ADDRESS and TON_INDEXER_URL.');
    console.warn(JSON.stringify(status));
    return;
  }

  const dbBundle = createDb(config.databaseUrl);
  const service = createPaymentsService(dbBundle.db, config);
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 3
  });

  try {
    await redis.connect();
    do {
      await pollOnce({
        db: dbBundle.db,
        service,
        config,
        statusStore: (patch) => updatePaymentWorkerStatus(redis, patch)
      });
      if (shouldRunOnce()) break;
      await sleep(Number(config.tonPaymentPollIntervalSeconds) * 1000);
    } while (true);
  } finally {
    await redis.quit();
    if (dbBundle.pool) await dbBundle.pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
