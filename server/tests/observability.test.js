import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

function testConfig(extra = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3101',
    PUBLIC_APP_ORIGIN: 'https://demo.example.com',
    TON_PROOF_DOMAIN: 'demo.example.com',
    JWT_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    ...extra
  });
}

function fakeRedis() {
  const store = new Map();
  return {
    async set(key, value) {
      store.set(key, value);
      return 'OK';
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async ping() {
      return 'PONG';
    },
    async quit() {
      return 'OK';
    }
  };
}

test('request id is accepted returned and included in safe structured logs', async () => {
  const entries = [];
  const logger = {
    info(line) {
      entries.push(line);
    }
  };
  const app = await buildServer(testConfig(), {
    dbBundle: {},
    redis: fakeRedis(),
    observabilityLogger: logger
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: {
      'x-request-id': 'obs-request-1',
      authorization: 'Bearer super.secret.jwt'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-request-id'], 'obs-request-1');
  assert.equal(entries.length, 1);

  const rawLog = entries[0];
  assert.equal(rawLog.includes('Authorization'), false);
  assert.equal(rawLog.includes('authorization'), false);
  assert.equal(rawLog.includes('super.secret.jwt'), false);

  const log = JSON.parse(rawLog);
  assert.equal(log.event, 'http_request');
  assert.equal(log.request_id, 'obs-request-1');
  assert.equal(log.route, '/api/health');
  assert.equal(log.method, 'GET');
  assert.equal(log.status, 200);
  assert.equal(log.error_code, null);
  assert.equal(typeof log.duration_ms, 'number');

  await app.close();
});

test('metrics endpoint is disabled by default', async () => {
  const app = await buildServer(testConfig(), {
    dbBundle: {},
    redis: fakeRedis()
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/metrics'
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'metrics_disabled');

  await app.close();
});

test('metrics endpoint exposes basic prometheus metrics when enabled', async () => {
  const redis = fakeRedis();
  await redis.set('payments:worker:status', JSON.stringify({
    status: 'ok',
    runsTotal: 2,
    errorsTotal: 1,
    lastRunAt: '2026-04-27T12:00:00.000Z',
    lastSuccessAt: '2026-04-27T12:00:00.000Z'
  }));
  const app = await buildServer(testConfig({ METRICS_ENABLED: 'true' }), {
    dbBundle: {
      pool: {
        async query() {
          return { rows: [] };
        },
        async end() {}
      }
    },
    redis
  });

  await app.inject({ method: 'GET', url: '/api/health' });
  const response = await app.inject({
    method: 'GET',
    url: '/api/metrics'
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /http_requests_total/);
  assert.match(response.body, /dependency_ready\{dependency="db"\} 1/);
  assert.match(response.body, /dependency_ready\{dependency="redis"\} 1/);
  assert.match(response.body, /payment_worker_errors_total 1/);

  await app.close();
});
