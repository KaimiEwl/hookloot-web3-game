import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { signSessionToken } from '../src/auth/jwt.js';
import { canTransitionWithdrawalStatus } from '../src/admin/service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_TOKEN = 'admin-test-token';
const ADMIN_WALLET = 'EQ_ADMIN';

test('manual withdrawal status transitions allow only review-safe paths', () => {
  assert.equal(canTransitionWithdrawalStatus('pending', 'under_review'), true);
  assert.equal(canTransitionWithdrawalStatus('under_review', 'rejected'), true);
  assert.equal(canTransitionWithdrawalStatus('approved_manual', 'paid_external'), true);
  assert.equal(canTransitionWithdrawalStatus('paid_external', 'rejected'), false);
  assert.equal(canTransitionWithdrawalStatus('rejected', 'paid_external'), false);
  assert.equal(canTransitionWithdrawalStatus('pending', 'approved_manual'), false);
});

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
    ...overrides
  });
}

function fakeRedis() {
  return {
    async set() { return 'OK'; },
    async get() { return null; },
    async del() { return 0; },
    async incr() { return 1; },
    async expire() { return 1; },
    async quit() { return 'OK'; }
  };
}

async function authHeader(config, walletAddress = ADMIN_WALLET) {
  const { token } = await signSessionToken({
    userId: USER_ID,
    sessionId: SESSION_ID,
    walletAddress,
    config,
    now: new Date()
  });
  return `Bearer ${token}`;
}

function createAdminService() {
  const calls = [];
  const page = { items: [{ id: 'row-1' }], nextCursor: '2' };
  return {
    calls,
    mutations: 0,
    async recordAccess(input) {
      calls.push(['recordAccess', input.route, input.metadata]);
    },
    async listUsers(input) {
      calls.push(['listUsers', input]);
      return page;
    },
    async getUser(input) {
      calls.push(['getUser', input]);
      return { user: { id: input.userId }, wallets: [], inventory: [], activeSlots: [], boosts: [] };
    },
    async getUserLedger(input) {
      calls.push(['getUserLedger', input]);
      return page;
    },
    async getUserTasks(input) {
      calls.push(['getUserTasks', input]);
      return page;
    },
    async getUserReferrals(input) {
      calls.push(['getUserReferrals', input]);
      return page;
    },
    async listPaymentOrders(input) {
      calls.push(['listPaymentOrders', input]);
      return page;
    },
    async getPayment(input) {
      calls.push(['getPayment', input]);
      return { order: { orderId: input.orderId }, payments: [] };
    },
    async listWithdrawals(input) {
      calls.push(['listWithdrawals', input]);
      return page;
    },
    async getWithdrawal(input) {
      calls.push(['getWithdrawal', input]);
      return { id: input.id, status: 'pending' };
    },
    async markWithdrawalUnderReview(input) {
      calls.push(['markWithdrawalUnderReview', input]);
      return { withdrawal: { id: input.id, status: 'under_review' } };
    },
    async rejectWithdrawal(input) {
      calls.push(['rejectWithdrawal', input]);
      return { withdrawal: { id: input.id, status: 'rejected', reason: input.reason } };
    },
    async markWithdrawalPaidExternal(input) {
      calls.push(['markWithdrawalPaidExternal', input]);
      return { withdrawal: { id: input.id, status: 'paid_external' } };
    },
    async listAuditLogs(input) {
      calls.push(['listAuditLogs', input]);
      return page;
    }
  };
}

test('admin disabled returns blocked response', async () => {
  const config = testConfig({ ADMIN_PANEL_ENABLED: 'false', ADMIN_BEARER_TOKEN: ADMIN_TOKEN });
  const adminService = createAdminService();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    adminService
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/users',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'admin_disabled');
  assert.equal(adminService.calls.length, 0);

  await app.close();
});

test('admin enabled without valid token or admin wallet returns unauthorized', async () => {
  const config = testConfig({ ADMIN_PANEL_ENABLED: 'true', ADMIN_BEARER_TOKEN: ADMIN_TOKEN });
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    adminService: createAdminService()
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/users'
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'admin_unauthorized');

  await app.close();
});

test('non-admin cannot use withdrawal review actions', async () => {
  const config = testConfig({ ADMIN_PANEL_ENABLED: 'true', ADMIN_BEARER_TOKEN: ADMIN_TOKEN });
  const adminService = createAdminService();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    adminService
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/withdrawals/33333333-3333-4333-8333-333333333333/reject',
    headers: { 'idempotency-key': 'reject-key' },
    payload: { reason: 'No admin auth' }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'admin_unauthorized');
  assert.equal(adminService.calls.some(([name]) => name === 'rejectWithdrawal'), false);

  await app.close();
});

test('admin list pagination is validated and passed to service', async () => {
  const config = testConfig({ ADMIN_PANEL_ENABLED: 'true', ADMIN_BEARER_TOKEN: ADMIN_TOKEN });
  const adminService = createAdminService();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    adminService
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/users?query=eq&limit=2&cursor=4',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.nextCursor, '2');
  const listCall = adminService.calls.find(([name]) => name === 'listUsers');
  assert.deepEqual(listCall[1], { query: 'eq', limit: 2, cursor: '4' });
  assert.ok(adminService.calls.find(([name, route]) => name === 'recordAccess' && route === 'admin.users.list'));

  await app.close();
});

test('admin wallet session can access read-only endpoints', async () => {
  const config = testConfig({
    ADMIN_PANEL_ENABLED: 'true',
    ADMIN_WALLET_ADDRESSES: ADMIN_WALLET
  });
  const adminService = createAdminService();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    adminService
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/users',
    headers: { authorization: await authHeader(config) }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(adminService.calls.find(([name]) => name === 'listUsers')[1].limit, 25);

  await app.close();
});

test('admin read endpoints are read-only aside from audit access logging', async () => {
  const config = testConfig({ ADMIN_PANEL_ENABLED: 'true', ADMIN_BEARER_TOKEN: ADMIN_TOKEN });
  const adminService = createAdminService();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    adminService
  });
  const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
  const endpoints = [
    `/api/admin/users/${USER_ID}`,
    `/api/admin/users/${USER_ID}/ledger`,
    `/api/admin/users/${USER_ID}/tasks`,
    `/api/admin/users/${USER_ID}/referrals`,
    '/api/admin/payments/orders',
    '/api/admin/payments/order_123',
    '/api/admin/withdrawals',
    '/api/admin/withdrawals/33333333-3333-4333-8333-333333333333',
    '/api/admin/audit-logs'
  ];

  for (const url of endpoints) {
    const response = await app.inject({ method: 'GET', url, headers });
    assert.equal(response.statusCode, 200, url);
  }

  assert.equal(adminService.mutations, 0);
  assert.equal(adminService.calls.filter(([name]) => name === 'recordAccess').length, endpoints.length);
  assert.equal(adminService.calls.some(([name]) => /^create|update|delete|credit|debit|approve|reject$/i.test(name)), false);

  await app.close();
});

test('admin withdrawal actions require idempotency and call manual status service', async () => {
  const config = testConfig({ ADMIN_PANEL_ENABLED: 'true', ADMIN_BEARER_TOKEN: ADMIN_TOKEN });
  const adminService = createAdminService();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    adminService
  });
  const headers = {
    authorization: `Bearer ${ADMIN_TOKEN}`,
    'idempotency-key': 'withdrawal-action-key'
  };
  const id = '33333333-3333-4333-8333-333333333333';

  const missingKey = await app.inject({
    method: 'POST',
    url: `/api/admin/withdrawals/${id}/mark-under-review`,
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { note: 'Checking documents' }
  });
  assert.equal(missingKey.statusCode, 400);
  assert.equal(missingKey.json().error.code, 'missing_idempotency_key');

  const review = await app.inject({
    method: 'POST',
    url: `/api/admin/withdrawals/${id}/mark-under-review`,
    headers,
    payload: { note: 'Checking documents' }
  });
  assert.equal(review.statusCode, 200);
  assert.equal(review.json().data.withdrawal.status, 'under_review');

  const reviewCall = adminService.calls.find(([name]) => name === 'markWithdrawalUnderReview');
  assert.equal(reviewCall[1].id, id);
  assert.equal(reviewCall[1].note, 'Checking documents');
  assert.equal(reviewCall[1].idempotency.key, 'withdrawal-action-key');
  assert.ok(adminService.calls.find(([name, route]) => name === 'recordAccess' && route === 'admin.withdrawals.mark_under_review'));

  await app.close();
});

test('admin withdrawal reject and paid external require notes', async () => {
  const config = testConfig({ ADMIN_PANEL_ENABLED: 'true', ADMIN_BEARER_TOKEN: ADMIN_TOKEN });
  const adminService = createAdminService();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    adminService
  });
  const id = '33333333-3333-4333-8333-333333333333';
  const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };

  const rejectMissingReason = await app.inject({
    method: 'POST',
    url: `/api/admin/withdrawals/${id}/reject`,
    headers: { ...auth, 'idempotency-key': 'reject-key' },
    payload: { reason: '' }
  });
  assert.equal(rejectMissingReason.statusCode, 400);

  const paidMissingNote = await app.inject({
    method: 'POST',
    url: `/api/admin/withdrawals/${id}/mark-paid-external`,
    headers: { ...auth, 'idempotency-key': 'paid-key' },
    payload: { note: '' }
  });
  assert.equal(paidMissingNote.statusCode, 400);

  const rejected = await app.inject({
    method: 'POST',
    url: `/api/admin/withdrawals/${id}/reject`,
    headers: { ...auth, 'idempotency-key': 'reject-key-ok' },
    payload: { reason: 'Manual review failed' }
  });
  assert.equal(rejected.statusCode, 200);

  const paid = await app.inject({
    method: 'POST',
    url: `/api/admin/withdrawals/${id}/mark-paid-external`,
    headers: { ...auth, 'idempotency-key': 'paid-key-ok' },
    payload: { note: 'Paid in external wallet batch 1' }
  });
  assert.equal(paid.statusCode, 200);

  assert.ok(adminService.calls.find(([name]) => name === 'rejectWithdrawal'));
  assert.ok(adminService.calls.find(([name]) => name === 'markWithdrawalPaidExternal'));

  await app.close();
});
