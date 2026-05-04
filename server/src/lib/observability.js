import { performance } from 'node:perf_hooks';
import { getPaymentsRuntimeStatus } from '../payments/readiness.js';
import { readPaymentWorkerStatus } from '../payments/workerStatus.js';

function routeLabel(request) {
  return request.routeOptions?.url || request.routerPath || request.url.split('?')[0] || 'unknown';
}

function safeLog(logger, entry) {
  if (!logger || typeof logger.info !== 'function') return;
  logger.info(JSON.stringify(entry));
}

function escapeMetric(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(input) {
  const entries = Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}="${escapeMetric(value)}"`);
  return entries.length ? `{${entries.join(',')}}` : '';
}

function unixSeconds(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : 0;
}

export function createMetricsStore() {
  const http = new Map();
  let authFailures = 0;
  let actionFailures = 0;

  function keyFor(metric) {
    return JSON.stringify(metric);
  }

  return {
    recordHttp({ method, route, status, durationMs, errorCode }) {
      const metric = {
        method,
        route,
        status: String(status),
        errorCode: errorCode || 'none'
      };
      const key = keyFor(metric);
      const current = http.get(key) || { ...metric, count: 0, durationMsSum: 0 };
      current.count += 1;
      current.durationMsSum += Number(durationMs || 0);
      http.set(key, current);

      if (Number(status) === 401) authFailures += 1;
      if (Number(status) >= 400 && method === 'POST') actionFailures += 1;
    },

    render({ dbReady, redisReady, paymentWorkerStatus }) {
      const lines = [
        '# HELP http_requests_total Total HTTP requests.',
        '# TYPE http_requests_total counter'
      ];

      for (const metric of http.values()) {
        lines.push(`http_requests_total${labels({
          method: metric.method,
          route: metric.route,
          status: metric.status,
          error_code: metric.errorCode
        })} ${metric.count}`);
      }

      lines.push('# HELP http_request_duration_ms_sum Total HTTP request duration in milliseconds.');
      lines.push('# TYPE http_request_duration_ms_sum counter');
      for (const metric of http.values()) {
        lines.push(`http_request_duration_ms_sum${labels({
          method: metric.method,
          route: metric.route,
          status: metric.status,
          error_code: metric.errorCode
        })} ${metric.durationMsSum.toFixed(3)}`);
      }

      lines.push('# HELP auth_failures_total Total authentication failures.');
      lines.push('# TYPE auth_failures_total counter');
      lines.push(`auth_failures_total ${authFailures}`);

      lines.push('# HELP action_failures_total Total POST action failures.');
      lines.push('# TYPE action_failures_total counter');
      lines.push(`action_failures_total ${actionFailures}`);

      lines.push('# HELP dependency_ready Dependency readiness status.');
      lines.push('# TYPE dependency_ready gauge');
      lines.push(`dependency_ready${labels({ dependency: 'db' })} ${dbReady ? 1 : 0}`);
      lines.push(`dependency_ready${labels({ dependency: 'redis' })} ${redisReady ? 1 : 0}`);

      const worker = paymentWorkerStatus || {};
      lines.push('# HELP payment_worker_status Payment worker status by label.');
      lines.push('# TYPE payment_worker_status gauge');
      lines.push(`payment_worker_status${labels({ status: worker.status || 'unknown' })} 1`);
      lines.push('# HELP payment_worker_errors_total Total payment worker errors.');
      lines.push('# TYPE payment_worker_errors_total counter');
      lines.push(`payment_worker_errors_total ${Number(worker.errorsTotal || 0)}`);
      lines.push('# HELP payment_worker_last_run_timestamp_seconds Last payment worker run timestamp.');
      lines.push('# TYPE payment_worker_last_run_timestamp_seconds gauge');
      lines.push(`payment_worker_last_run_timestamp_seconds ${unixSeconds(worker.lastRunAt)}`);
      lines.push('# HELP payment_worker_last_success_timestamp_seconds Last successful payment worker timestamp.');
      lines.push('# TYPE payment_worker_last_success_timestamp_seconds gauge');
      lines.push(`payment_worker_last_success_timestamp_seconds ${unixSeconds(worker.lastSuccessAt)}`);

      return `${lines.join('\n')}\n`;
    }
  };
}

export function registerObservability(fastify, {
  metrics,
  logger,
  enabled = true
}) {
  fastify.addHook('onRequest', async (request) => {
    request.observabilityStart = performance.now();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const durationMs = performance.now() - (request.observabilityStart || performance.now());
    const route = routeLabel(request);
    const method = request.method;
    const status = reply.statusCode;
    const errorCode = reply.errorCode || null;
    const userId = request.auth?.userId || null;

    metrics.recordHttp({ method, route, status, durationMs, errorCode });

    if (enabled) {
      safeLog(logger, {
        level: 'info',
        event: 'http_request',
        request_id: request.id,
        route,
        method,
        status,
        duration_ms: Number(durationMs.toFixed(3)),
        user_id: userId,
        error_code: errorCode,
        at: new Date().toISOString()
      });
    }
  });
}

export async function checkReadiness({ dbBundle, redis, config }) {
  const checks = {
    db: { ok: true },
    redis: { ok: true },
    payments: getPaymentsRuntimeStatus(config),
    metrics: { enabled: Boolean(config.metricsEnabled) }
  };

  try {
    if (dbBundle.pool?.query) await dbBundle.pool.query('select 1');
  } catch (error) {
    checks.db = { ok: false, reason: error?.message || 'db_unavailable' };
  }

  try {
    if (typeof redis.ping === 'function') await redis.ping();
  } catch (error) {
    checks.redis = { ok: false, reason: error?.message || 'redis_unavailable' };
  }

  return {
    ready: checks.db.ok && checks.redis.ok,
    checks
  };
}

export async function renderMetrics({ metrics, dbBundle, redis, config }) {
  const readiness = await checkReadiness({ dbBundle, redis, config });
  const paymentWorkerStatus = await readPaymentWorkerStatus(redis);
  return metrics.render({
    dbReady: readiness.checks.db.ok,
    redisReady: readiness.checks.redis.ok,
    paymentWorkerStatus
  });
}
