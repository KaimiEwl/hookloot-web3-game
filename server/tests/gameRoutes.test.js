import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { signSessionToken } from '../src/auth/jwt.js';

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
    async set() {
      return 'OK';
    },
    async get() {
      return null;
    },
    async del() {
      return 0;
    },
    async quit() {
      return 'OK';
    }
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

function fakeState() {
  return {
    balance: { units: '0', coins: '0' },
    balanceUnits: '0',
    inventory: [],
    activeSlots: { slots: [], counts: {} },
    boosts: [],
    incomePerHour: { units: '0', coins: '0' },
    incomePerHourUnits: '0',
    serverTime: '2026-04-27T12:00:00.000Z',
    lastMinedAt: '2026-04-27T12:00:00.000Z'
  };
}

test('GET /api/game/state returns authoritative state and rejects client balance query', async () => {
  const config = testConfig();
  const gameService = {
    async getState({ userId }) {
      assert.equal(userId, '11111111-1111-4111-8111-111111111111');
      return fakeState();
    },
    async sync() {
      throw new Error('not used');
    }
  };
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    gameService
  });
  const authorization = await authHeader(config);

  const okResponse = await app.inject({
    method: 'GET',
    url: '/api/game/state',
    headers: { authorization }
  });
  assert.equal(okResponse.statusCode, 200);
  assert.equal(okResponse.json().data.balanceUnits, '0');

  const rejected = await app.inject({
    method: 'GET',
    url: '/api/game/state?balance=999999',
    headers: { authorization }
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error.code, 'validation_error');

  await app.close();
});

test('POST /api/game/sync ignores client economy payload and validates idempotency header', async () => {
  const config = testConfig();
  const gameService = {
    async getState() {
      throw new Error('not used');
    },
    async sync({ idempotencyKey }) {
      assert.equal(idempotencyKey, 'sync-test-0001');
      return fakeState();
    }
  };
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    gameService
  });
  const authorization = await authHeader(config);

  const invalidPayload = await app.inject({
    method: 'POST',
    url: '/api/game/sync',
    headers: { authorization },
    payload: { balance: 999999 }
  });
  assert.equal(invalidPayload.statusCode, 400);
  assert.equal(invalidPayload.json().error.code, 'validation_error');

  const okResponse = await app.inject({
    method: 'POST',
    url: '/api/game/sync',
    headers: {
      authorization,
      'idempotency-key': 'sync-test-0001'
    },
    payload: {}
  });
  assert.equal(okResponse.statusCode, 200);
  assert.equal(okResponse.json().data.incomePerHourUnits, '0');

  await app.close();
});
