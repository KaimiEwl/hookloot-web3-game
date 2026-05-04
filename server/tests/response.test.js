import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3101',
    PUBLIC_APP_ORIGIN: 'https://demo.example.com',
    TON_PROOF_DOMAIN: 'demo.example.com',
    JWT_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db',
    REDIS_URL: 'redis://127.0.0.1:6379/0'
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

test('health endpoint returns unified success envelope', async () => {
  const app = await buildServer(testConfig(), {
    dbBundle: {},
    redis: fakeRedis()
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: {
      'x-request-id': 'test-request-1'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-request-id'], 'test-request-1');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');

  const body = response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.data, { status: 'ok' });
  assert.equal(body.error, null);
  assert.equal(body.meta.requestId, 'test-request-1');
  assert.match(body.meta.serverTime, /^\d{4}-\d{2}-\d{2}T/);

  await app.close();
});

test('ready endpoint returns dependency readiness envelope', async () => {
  const app = await buildServer(testConfig(), {
    dbBundle: {
      pool: {
        async query(sql) {
          assert.equal(sql, 'select 1');
          return { rows: [] };
        },
        async end() {}
      }
    },
    redis: fakeRedis()
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/ready'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().data.status, 'ready');

  await app.close();
});

test('validation errors return unified error envelope', async () => {
  const app = await buildServer(testConfig(), {
    dbBundle: {},
    redis: fakeRedis()
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/verify',
    headers: {
      'x-request-id': 'test-request-2'
    },
    payload: {}
  });

  assert.equal(response.statusCode, 400);

  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(body.data, null);
  assert.equal(body.error.code, 'validation_error');
  assert.ok(Array.isArray(body.error.details));
  assert.equal(body.meta.requestId, 'test-request-2');
  assert.match(body.meta.serverTime, /^\d{4}-\d{2}-\d{2}T/);

  await app.close();
});
