import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { signSessionToken } from '../src/auth/jwt.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3101',
    PUBLIC_APP_ORIGIN: 'https://demo.example.com',
    TON_PROOF_DOMAIN: 'demo.example.com',
    JWT_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    RATE_LIMIT_AUTH_MAX: '30',
    RATE_LIMIT_ACTIONS_MAX: '120',
    ...overrides
  });
}

function fakeRedis() {
  const store = new Map();
  return {
    async set(key, value) { store.set(key, value); return 'OK'; },
    async get(key) { return store.get(key) ?? null; },
    async del(key) { return store.delete(key) ? 1 : 0; },
    async incr(key) {
      const value = Number(store.get(key) || 0) + 1;
      store.set(key, value);
      return value;
    },
    async expire() { return 1; },
    async quit() { return 'OK'; }
  };
}

async function authHeader(config) {
  const { token } = await signSessionToken({
    userId: USER_ID,
    sessionId: SESSION_ID,
    walletAddress: 'EQ_TEST',
    config,
    now: new Date()
  });
  return `Bearer ${token}`;
}

function fakeState() {
  return {
    balanceUnits: '0',
    balance: { units: '0', coins: '0' },
    inventory: [],
    activeSlots: { slots: [], counts: {} },
    boosts: [],
    incomePerHourUnits: '0',
    incomePerHour: { units: '0', coins: '0' },
    serverTime: '2026-04-27T12:00:00.000Z',
    lastMinedAt: '2026-04-27T12:00:00.000Z'
  };
}

test('Telegram verify requires TON session and forwards raw initData only', async () => {
  const config = testConfig();
  const calls = [];
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    socialService: {
      async verifyTelegram(input) {
        calls.push(input);
        return { linked: true, telegramUser: { id: '42', username: 'miner' } };
      }
    },
    gameService: { async getState() { return fakeState(); }, async sync() { return fakeState(); } }
  });
  const authorization = await authHeader(config);

  const unauthenticated = await app.inject({
    method: 'POST',
    url: '/api/auth/telegram/verify',
    payload: { initData: 'auth_date=1&hash=x' }
  });
  assert.equal(unauthenticated.statusCode, 401);

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/telegram/verify',
    headers: { authorization },
    payload: { initData: 'auth_date=1&hash=x' }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].userId, USER_ID);
  assert.equal(calls[0].initData, 'auth_date=1&hash=x');
  assert.equal('initDataUnsafe' in calls[0], false);

  await app.close();
});

test('Telegram verify rejects initDataUnsafe and still requires active TON auth', async () => {
  const config = testConfig();
  const calls = [];
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    socialService: {
      async verifyTelegram(input) {
        calls.push(input);
        return { linked: true };
      }
    },
    gameService: { async getState() { return fakeState(); }, async sync() { return fakeState(); } }
  });
  const authorization = await authHeader(config);

  const rejected = await app.inject({
    method: 'POST',
    url: '/api/auth/telegram/verify',
    headers: { authorization },
    payload: {
      initData: 'auth_date=1&hash=x',
      initDataUnsafe: { user: { id: 42 } }
    }
  });

  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error.code, 'validation_error');
  assert.equal(calls.length, 0);

  const noAuth = await app.inject({
    method: 'POST',
    url: '/api/auth/telegram/verify',
    payload: { initData: 'auth_date=1&hash=x' }
  });

  assert.equal(noAuth.statusCode, 401);
  assert.equal(calls.length, 0);

  await app.close();
});

test('tasks and referrals routes use auth, idempotency and do not accept rewards from client', async () => {
  const config = testConfig();
  const calls = [];
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    tasksService: {
      async listTasks(input) {
        calls.push(['listTasks', input]);
        return { tasks: [{ id: 'task_1', taskCode: 'connect_telegram', status: 'pending' }] };
      },
      async claimTask(input) {
        calls.push(['claimTask', input]);
        return {
          action: { type: 'task_claimed' },
          state: fakeState()
        };
      }
    },
    referralsService: {
      async getMe(input) {
        calls.push(['getMe', input]);
        return { code: 'miner_abc', referralLink: 'https://demo.example.com/?ref=miner_abc', relationships: [] };
      },
      async applyCode(input) {
        calls.push(['applyCode', input]);
        return { referral: { status: 'linked' } };
      }
    },
    gameService: { async getState() { return fakeState(); }, async sync() { return fakeState(); } }
  });
  const authorization = await authHeader(config);

  const list = await app.inject({
    method: 'GET',
    url: '/api/tasks',
    headers: { authorization }
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().data.tasks[0].taskCode, 'connect_telegram');

  const missingKey = await app.inject({
    method: 'POST',
    url: '/api/tasks/claim',
    headers: { authorization },
    payload: { taskId: 'connect_telegram' }
  });
  assert.equal(missingKey.statusCode, 400);
  assert.equal(missingKey.json().error.code, 'missing_idempotency_key');

  const rejectedClientReward = await app.inject({
    method: 'POST',
    url: '/api/tasks/claim',
    headers: { authorization, 'idempotency-key': 'task-claim-0001' },
    payload: { taskId: 'connect_telegram', rewardUnits: '999999' }
  });
  assert.equal(rejectedClientReward.statusCode, 400);
  assert.equal(rejectedClientReward.json().error.code, 'validation_error');

  const claim = await app.inject({
    method: 'POST',
    url: '/api/tasks/claim',
    headers: { authorization, 'idempotency-key': 'task-claim-0002' },
    payload: { task_id: 'connect_telegram' }
  });
  assert.equal(claim.statusCode, 200);
  assert.equal(claim.json().data.state.balanceUnits, '0');

  const referrals = await app.inject({
    method: 'GET',
    url: '/api/referrals/me',
    headers: { authorization }
  });
  assert.equal(referrals.statusCode, 200);
  assert.equal(referrals.json().data.code, 'miner_abc');

  const apply = await app.inject({
    method: 'POST',
    url: '/api/referrals/apply-code',
    headers: { authorization, 'idempotency-key': 'ref-apply-0001' },
    payload: { code: 'miner_friend' }
  });
  assert.equal(apply.statusCode, 200);

  assert.equal(calls.find(([name]) => name === 'claimTask')[1].taskId, 'connect_telegram');
  assert.equal(calls.find(([name]) => name === 'claimTask')[1].idempotency.key, 'task-claim-0002');
  assert.equal('rewardUnits' in calls.find(([name]) => name === 'claimTask')[1], false);
  assert.equal(calls.find(([name]) => name === 'applyCode')[1].code, 'miner_friend');

  await app.close();
});

test('auth rate limit returns unified envelope', async () => {
  const config = testConfig({ RATE_LIMIT_AUTH_MAX: '1' });
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis()
  });

  const first = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/payload',
    payload: {}
  });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/payload',
    payload: {}
  });
  assert.equal(second.statusCode, 429);
  assert.equal(second.json().ok, false);
  assert.equal(second.json().error.code, 'rate_limited');
  assert.equal(second.headers['retry-after'], '60');

  await app.close();
});
