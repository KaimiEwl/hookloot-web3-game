import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createApiClient,
  ApiEnvelopeError,
  clearApiAuthSession,
  getApiAuthToken,
  setApiAuthSession
} from '../src/core/api.js';
import { APP_SCREENS, STORAGE_KEYS } from '../src/core/constants.js';
import { shouldExposeDebugEconomyGlobals } from '../src/core/devGuards.js';
import { applyAuthoritativeGameState, formatUnitsForDisplay, projectBalanceUnits } from '../src/core/serverState.js';
import { loadAppState } from '../src/core/state.js';
import {
  extractReferralInvites,
  getTaskStatus,
  getTelegramWebAppInitData
} from '../src/modules/tasks/controller.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}

test('client API loads game state through GET /api/game/state envelope', async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: '/api',
    getAuthToken: () => 'session-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          data: { balanceUnits: '123000000', incomePerHourUnits: '3600000' },
          error: null,
          meta: { requestId: 'req_1', serverTime: new Date().toISOString() }
        })
      };
    }
  });

  const state = await api.getGameState();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/game/state');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer session-token');
  assert.equal(state.balanceUnits, '123000000');
});

test('client API retries safe GET but does not retry POST mutation', async () => {
  let getCalls = 0;
  const getApi = createApiClient({
    baseUrl: '/api',
    fetchImpl: async () => {
      getCalls += 1;
      if (getCalls === 1) throw new Error('temporary');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, data: { ok: true }, error: null, meta: {} })
      };
    }
  });
  await getApi.getGameState();
  assert.equal(getCalls, 2);

  let postCalls = 0;
  const postApi = createApiClient({
    baseUrl: '/api',
    fetchImpl: async () => {
      postCalls += 1;
      throw new Error('fail');
    }
  });
  await assert.rejects(() => postApi.syncGameState(), ApiEnvelopeError);
  assert.equal(postCalls, 1);
});

test('client API error envelope becomes UI-safe ApiEnvelopeError', async () => {
  const api = createApiClient({
    baseUrl: '/api',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({
        ok: false,
        data: null,
        error: { code: 'missing_auth', message: 'Authorization bearer token is required' },
        meta: { requestId: 'req_error', serverTime: new Date().toISOString() }
      })
    })
  });

  await assert.rejects(
    () => api.getGameState(),
    (error) => error instanceof ApiEnvelopeError
      && error.status === 401
      && error.code === 'missing_auth'
  );
});

test('401 API responses clear only bearer auth session', async () => {
  const storage = createMemoryStorage();
  globalThis.window = { sessionStorage: storage };
  setApiAuthSession({ token: 'expired-token', expiresAt: new Date(Date.now() + 60_000).toISOString() });

  const api = createApiClient({
    baseUrl: '/api',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({
        ok: false,
        data: null,
        error: { code: 'invalid_auth', message: 'Invalid or expired session token' },
        meta: { requestId: 'req_401' }
      })
    })
  });

  await assert.rejects(() => api.getGameState(), ApiEnvelopeError);
  assert.equal(getApiAuthToken(), '');
  assert.equal(storage.getItem(STORAGE_KEYS.STATE), null);

  delete globalThis.window;
  clearApiAuthSession();
});

test('logout endpoint uses current bearer token and clears auth session', async () => {
  const storage = createMemoryStorage();
  globalThis.window = { sessionStorage: storage };
  setApiAuthSession({ token: 'active-token', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const calls = [];

  const api = createApiClient({
    baseUrl: '/api',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body || '{}') });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          data: { loggedOut: true, revoked: true },
          error: null,
          meta: {}
        })
      };
    }
  });

  const result = await api.logoutAuthSession();
  assert.deepEqual(result, { loggedOut: true, revoked: true });
  assert.equal(calls[0].url, '/api/auth/logout');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer active-token');
  assert.deepEqual(calls[0].body, {});
  assert.equal(getApiAuthToken(), '');

  delete globalThis.window;
  clearApiAuthSession();
});

test('client action API sends only intent and idempotency key', async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: '/api',
    getAuthToken: () => 'session-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body || '{}') });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          data: { state: { balanceUnits: '5000000' } },
          error: null,
          meta: {}
        })
      };
    }
  });

  await api.buyShopItem({ rarityId: 'common', idempotencyKey: 'buy-common-0001' });
  await api.activateInventorySlot({ rarityId: 'common', slotIndex: 0, idempotencyKey: 'slot-common-0001' });
  await api.removeInventorySlot({ slotIndex: 0, idempotencyKey: 'slot-remove-0001' });
  await api.activateCoinBoost({ idempotencyKey: 'coin-boost-0001' });
  await api.activateNftBoost({ rarityId: 'rare', idempotencyKey: 'nft-boost-0001' });
  await api.createPaymentOrder({ itemId: 'nft_card:common', idempotencyKey: 'pay-common-0001' });
  await api.getPaymentOrder('order_1');
  await api.getPaymentsStatus();
  await api.createWithdrawalRequest({
    amountUnits: '1000',
    assetType: 'TON',
    destinationWallet: 'UQ_TEST_DESTINATION',
    idempotencyKey: 'withdraw-0001'
  });
  await api.claimTask({ taskId: 'connect_telegram', idempotencyKey: 'task-claim-0001' });
  await api.applyReferralCode({ code: 'FRIEND42', idempotencyKey: 'ref-apply-0001' });

  assert.deepEqual(calls.map((call) => call.url), [
    '/api/shop/buy',
    '/api/inventory/activate-slot',
    '/api/inventory/remove-slot',
    '/api/boosts/coin/activate',
    '/api/boosts/nft/activate',
    '/api/payments/orders',
    '/api/payments/orders/order_1',
    '/api/payments/status',
    '/api/withdrawals',
    '/api/tasks/claim',
    '/api/referrals/apply-code'
  ]);
  assert.deepEqual(calls[0].body, { itemId: 'nft_card', rarityId: 'common' });
  assert.deepEqual(calls[1].body, { itemId: 'nft_card', rarityId: 'common', slotIndex: 0 });
  assert.deepEqual(calls[2].body, { slotIndex: 0 });
  assert.deepEqual(calls[3].body, {});
  assert.deepEqual(calls[4].body, { rarityId: 'rare' });
  assert.deepEqual(calls[5].body, { itemId: 'nft_card:common' });
  assert.deepEqual(calls[8].body, { amountUnits: '1000', assetType: 'TON', destinationWallet: 'UQ_TEST_DESTINATION' });
  assert.deepEqual(calls[9].body, { taskId: 'connect_telegram' });
  assert.deepEqual(calls[10].body, { code: 'FRIEND42' });
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'buy-common-0001');
  assert.equal(calls[5].init.headers['Idempotency-Key'], 'pay-common-0001');
  assert.equal(calls[8].init.headers['Idempotency-Key'], 'withdraw-0001');
  assert.equal(calls[9].init.headers['Idempotency-Key'], 'task-claim-0001');
  assert.equal(calls[10].init.headers['Idempotency-Key'], 'ref-apply-0001');
  for (const call of calls) {
    assert.equal('balance' in call.body, false);
    assert.equal('cost' in call.body, false);
    assert.equal('reward' in call.body, false);
    assert.equal('incomePerHour' in call.body, false);
    assert.equal('receiverWallet' in call.body, false);
    assert.equal('payload' in call.body, false);
  }
});

test('tasks and referrals are fetched from backend', async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: '/api',
    getAuthToken: () => 'session-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const data = url.endsWith('/tasks')
        ? { tasks: [{ id: 'connect_telegram', status: 'ready_to_claim', rewardUnits: '1000000' }] }
        : { referralCode: 'ABC123', referrals: [] };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, data, error: null, meta: {} })
      };
    }
  });

  const tasks = await api.getTasks();
  const referrals = await api.getReferralsMe();

  assert.equal(calls[0].url, '/api/tasks');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].url, '/api/referrals/me');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(tasks.tasks[0].id, 'connect_telegram');
  assert.equal(referrals.referralCode, 'ABC123');
});

test('admin debug API uses read-only GET endpoints', async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: '/api',
    getAuthToken: () => 'session-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          data: url.includes('/payments/order_1') || url.endsWith('/users/user_1')
            ? { ok: true }
            : { items: [], nextCursor: null },
          error: null,
          meta: {}
        })
      };
    }
  });

  await api.getAdminUsers({ query: 'eq', limit: 10, cursor: '20' });
  await api.getAdminUser('user_1');
  await api.getAdminUserLedger('user_1', { limit: 5 });
  await api.getAdminUserTasks('user_1');
  await api.getAdminUserReferrals('user_1');
  await api.getAdminPaymentOrders({ limit: 5 });
  await api.getAdminPayment('order_1');
  await api.getAdminWithdrawals();
  await api.getAdminAuditLogs();

  assert.deepEqual(calls.map((call) => call.url), [
    '/api/admin/users?query=eq&limit=10&cursor=20',
    '/api/admin/users/user_1',
    '/api/admin/users/user_1/ledger?limit=5',
    '/api/admin/users/user_1/tasks',
    '/api/admin/users/user_1/referrals',
    '/api/admin/payments/orders?limit=5',
    '/api/admin/payments/order_1',
    '/api/admin/withdrawals',
    '/api/admin/audit-logs'
  ]);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.headers.Authorization, 'Bearer session-token');
    assert.equal('Idempotency-Key' in call.init.headers, false);
  }
});

test('task claim does not mutate local balance before server response', async () => {
  const runtime = loadAppState(STORAGE_KEYS.STATE);
  applyAuthoritativeGameState(runtime, {
    balanceUnits: '1000000',
    incomePerHourUnits: '0',
    inventory: [],
    activeSlots: { counts: {} },
    boosts: [],
    serverTime: '2026-04-27T00:00:00.000Z',
    lastMinedAt: '2026-04-27T00:00:00.000Z'
  }, { receivedAt: 1_000 });

  let resolveResponse;
  const api = createApiClient({
    baseUrl: '/api',
    getAuthToken: () => 'session-token',
    fetchImpl: async () => new Promise((resolve) => {
      resolveResponse = () => resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          data: {
            state: {
              balanceUnits: '2500000',
              incomePerHourUnits: '0',
              inventory: [],
              activeSlots: { counts: {} },
              boosts: [],
              serverTime: '2026-04-27T00:00:01.000Z',
              lastMinedAt: '2026-04-27T00:00:01.000Z'
            }
          },
          error: null,
          meta: {}
        })
      });
    })
  });

  const claimPromise = api.claimTask({ taskId: 'connect_telegram', idempotencyKey: 'claim-1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.balanceUnits, '1000000');
  assert.equal(runtime.balance, 1);

  resolveResponse();
  const result = await claimPromise;
  applyAuthoritativeGameState(runtime, result.state, { receivedAt: 2_000 });
  assert.equal(runtime.balanceUnits, '2500000');
  assert.equal(runtime.balance, 2.5);
});

test('referral apply surfaces server errors', async () => {
  const api = createApiClient({
    baseUrl: '/api',
    getAuthToken: () => 'session-token',
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({
        ok: false,
        data: null,
        error: { code: 'self_referral_rejected', message: 'Self-referral is not allowed' },
        meta: {}
      })
    })
  });

  await assert.rejects(
    () => api.applyReferralCode({ code: 'OWNCODE', idempotencyKey: 'ref-self' }),
    (error) => error instanceof ApiEnvelopeError
      && error.status === 409
      && error.code === 'self_referral_rejected'
  );
});

test('Telegram link sends raw initData and never trusts initDataUnsafe', async () => {
  const calls = [];
  const fakeWindow = {
    Telegram: {
      WebApp: {
        initData: 'query_id=abc&user=%7B%7D&hash=valid',
        initDataUnsafe: { user: { id: 123 }, hash: 'not-trusted' }
      }
    }
  };
  const api = createApiClient({
    baseUrl: '/api',
    getAuthToken: () => 'session-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body || '{}') });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, data: { linked: true }, error: null, meta: {} })
      };
    }
  });

  await api.verifyTelegramWebApp({ initData: getTelegramWebAppInitData(fakeWindow) });

  assert.equal(calls[0].url, '/api/auth/telegram/verify');
  assert.deepEqual(calls[0].body, { initData: 'query_id=abc&user=%7B%7D&hash=valid' });
  assert.equal('initDataUnsafe' in calls[0].body, false);
});

test('task status uses server readiness and exposes blocked setup states', () => {
  assert.equal(getTaskStatus({ status: 'pending', readiness: { ok: true } }), 'ready_to_claim');
  assert.equal(getTaskStatus({ readiness: { ok: false, reason: 'not_configured' } }), 'not_configured');
  assert.equal(getTaskStatus({ readiness: { ok: false, reason: 'telegram_not_linked' } }), 'needs_telegram');
  assert.equal(getTaskStatus({ readiness: { ok: false, reason: 'telegram_api_error', retryable: true } }), 'retryable_error');
  assert.equal(getTaskStatus({ readiness: { ok: false, reason: 'telegram_verification_unavailable' } }), 'verification_unavailable');
});

test('referral relationships from backend are shown as invites', () => {
  const invites = extractReferralInvites({
    code: 'MINER-E2E',
    relationships: [
      { id: 'rel-1', status: 'linked' },
      { id: 'rel-2', status: 'qualified' }
    ]
  });

  assert.equal(invites.length, 2);
  assert.equal(invites[1].status, 'qualified');
});

test('economic localStorage keys are ignored; only last screen survives', () => {
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;

  storage.setItem(STORAGE_KEYS.STATE, JSON.stringify({
    balance: 999999,
    inventory: { common: 99, rare: 99, epic: 99, legendary: 99, gold: 99 },
    activeSlots: { common: 9, rare: 9, epic: 9, legendary: 9, gold: 9 },
    activatedBoostTasks: { 'boost-common-x10': 10 },
    coinBoostLevel: 10
  }));
  storage.setItem(STORAGE_KEYS.SCREEN, APP_SCREENS.WALLET);

  const state = loadAppState(STORAGE_KEYS.STATE);
  assert.equal(state.balance, 0);
  assert.equal(state.inventory.common, 0);
  assert.equal(state.activeSlots.gold, 0);
  assert.equal(state.coinBoostLevel, 0);
  assert.deepEqual(state.activatedBoostTasks, {});
  assert.equal(state.ui.screen, APP_SCREENS.WALLET);

  delete globalThis.localStorage;
});

test('authoritative TON boost preserves server catalog plan id', () => {
  const runtime = loadAppState(STORAGE_KEYS.STATE);
  const activeUntil = new Date(Date.now() + 60_000).toISOString();

  applyAuthoritativeGameState(runtime, {
    balanceUnits: '0',
    incomePerHourUnits: '0',
    inventory: [],
    activeSlots: { counts: {} },
    boosts: [{
      boostType: 'ton_multiplier',
      level: 1,
      activeUntil,
      metadata: { planId: 'ton_x2_day', multiplier: 2 }
    }],
    serverTime: '2026-04-27T00:00:00.000Z',
    lastMinedAt: '2026-04-27T00:00:00.000Z'
  }, { receivedAt: 1_000 });

  assert.equal(runtime.tonBoost.planId, 'ton_x2_day');
  assert.equal(runtime.tonBoost.multiplier, 2);
});

test('authoritative server state replaces local runtime economy and projects display only', () => {
  const runtime = loadAppState(STORAGE_KEYS.STATE);
  runtime.balance = 999;
  runtime.inventory.common = 99;
  runtime.activeSlots.gold = 9;

  applyAuthoritativeGameState(runtime, {
    balanceUnits: '1000000',
    incomePerHourUnits: '3600000',
    inventory: [
      { rarityId: 'common', quantity: 2 },
      { rarityId: 'rare', quantity: 2 }
    ],
    activeSlots: { counts: { common: 1, rare: 0, epic: 0, legendary: 0, gold: 0 } },
    boosts: [{ boostType: 'coin', level: 2 }],
    serverTime: '2026-04-27T00:00:00.000Z',
    lastMinedAt: '2026-04-27T00:00:00.000Z'
  }, { receivedAt: 1_000 });

  assert.equal(runtime.balance, 1);
  assert.equal(runtime.inventory.common, 1);
  assert.equal(runtime.inventory.rare, 2);
  assert.equal(runtime.activeSlots.common, 1);
  assert.equal(runtime.collectedTotals.common, 2);
  assert.equal(runtime.coinBoostLevel, 2);
  assert.equal(formatUnitsForDisplay(projectBalanceUnits(runtime, 2_000), 3), '1.001');
});

test('production does not expose debug economy globals', () => {
  assert.equal(shouldExposeDebugEconomyGlobals({ DEV: false }), false);
  assert.equal(shouldExposeDebugEconomyGlobals({ DEV: true }), true);
});
