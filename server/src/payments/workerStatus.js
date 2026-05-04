const PAYMENT_WORKER_STATUS_KEY = 'payments:worker:status';
const PAYMENT_WORKER_STATUS_TTL_SECONDS = 7 * 24 * 60 * 60;

function safeStatus(input = {}) {
  return {
    worker: 'payments',
    status: input.status || 'unknown',
    runId: input.runId || null,
    runsTotal: Number(input.runsTotal || 0),
    errorsTotal: Number(input.errorsTotal || 0),
    lastRunAt: input.lastRunAt || null,
    lastSuccessAt: input.lastSuccessAt || null,
    lastCheckpoint: input.lastCheckpoint || null,
    lastError: input.lastError || null,
    updatedAt: input.updatedAt || null
  };
}

export async function readPaymentWorkerStatus(redis) {
  if (!redis || typeof redis.get !== 'function') return safeStatus();
  const raw = await redis.get(PAYMENT_WORKER_STATUS_KEY);
  if (!raw) return safeStatus();
  try {
    return safeStatus(JSON.parse(raw));
  } catch {
    return safeStatus({ status: 'invalid_status_payload' });
  }
}

export async function updatePaymentWorkerStatus(redis, patch = {}) {
  if (!redis || typeof redis.set !== 'function') return safeStatus(patch);
  const previous = await readPaymentWorkerStatus(redis);
  const now = new Date().toISOString();
  const next = safeStatus({
    ...previous,
    ...patch,
    runsTotal: previous.runsTotal + Number(patch.incrementRunsBy || 0),
    errorsTotal: previous.errorsTotal + Number(patch.incrementErrorsBy || 0),
    updatedAt: now
  });

  await redis.set(
    PAYMENT_WORKER_STATUS_KEY,
    JSON.stringify(next),
    'EX',
    PAYMENT_WORKER_STATUS_TTL_SECONDS
  );

  return next;
}
