import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { authenticateRequest } from '../src/auth/requireAuth.js';
import { signSessionToken } from '../src/auth/jwt.js';
import { createOrUpdateWalletSession, revokeSession } from '../src/auth/repository.js';
import { users, wallets, sessions, authEvents, auditLogs } from '../src/db/schema.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ID = '33333333-3333-4333-8333-333333333333';

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
    async quit() { return 'OK'; }
  };
}

function createRepositoryDb() {
  const state = {
    users: [],
    wallets: [],
    sessions: [],
    authEvents: [],
    auditLogs: []
  };

  function insertRow(table, value) {
    if (table === users) {
      const row = { id: USER_ID, status: 'active', createdAt: new Date(), updatedAt: new Date(), ...value };
      state.users.push(row);
      return row;
    }
    if (table === wallets) {
      const row = { id: WALLET_ID, createdAt: new Date(), updatedAt: new Date(), verifiedAt: new Date(), ...value };
      state.wallets.push(row);
      return row;
    }
    if (table === sessions) {
      state.sessions.push(value);
      return value;
    }
    if (table === authEvents) {
      state.authEvents.push(value);
      return value;
    }
    if (table === auditLogs) {
      state.auditLogs.push(value);
      return value;
    }
    return value;
  }

  const tx = {
    select() {
      return {
        from(table) {
          return {
            where() {
              return {
                limit: async () => (table === wallets ? state.wallets : [])
              };
            }
          };
        }
      };
    },
    insert(table) {
      return {
        values(value) {
          const row = insertRow(table, value);
          return {
            returning: async () => [row]
          };
        }
      };
    },
    update(table) {
      return {
        set(values) {
          return {
            where() {
              return {
                returning: async () => {
                  if (table !== sessions) return [];
                  const active = state.sessions.filter((session) => !session.revokedAt);
                  active.forEach((session) => Object.assign(session, values));
                  return active.map((session) => ({ id: session.id }));
                }
              };
            }
          };
        }
      };
    }
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    }
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

test('TON login repository creates a server session and auth/audit events', async () => {
  const db = createRepositoryDb();
  const result = await createOrUpdateWalletSession(db, {
    wallet: {
      address: 'EQ_TEST',
      rawAddress: '0:abc',
      network: 'testnet',
      publicKey: 'public-key'
    },
    config: testConfig(),
    userAgent: 'node-test',
    ip: '127.0.0.1'
  });

  assert.ok(result.token);
  assert.equal(result.user.id, USER_ID);
  assert.equal(db.state.users.length, 1);
  assert.equal(db.state.wallets.length, 1);
  assert.equal(db.state.sessions.length, 1);
  assert.equal(db.state.sessions[0].userId, USER_ID);
  assert.equal(db.state.authEvents.some((event) => event.type === 'ton_proof_verified'), true);
  assert.equal(db.state.auditLogs.some((event) => event.eventType === 'ton_proof_verified'), true);

  const logout = await revokeSession(db, {
    userId: USER_ID,
    sessionId: db.state.sessions[0].id,
    walletAddress: 'EQ_TEST',
    request: { ip: '127.0.0.1', headers: { 'user-agent': 'node-test' } }
  });
  assert.equal(logout.revoked, true);
  assert.equal(db.state.authEvents.some((event) => event.type === 'logout'), true);
  assert.equal(db.state.auditLogs.some((event) => event.eventType === 'logout'), true);
});

test('GET /api/auth/me returns sanitized current user data', async () => {
  const config = testConfig();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    authService: {
      authenticate: async () => ({ ok: true, userId: USER_ID, sessionId: SESSION_ID, walletAddress: 'EQ_TEST' }),
      getCurrentUser: async () => ({
        user: { id: USER_ID, status: 'active', createdAt: new Date(), updatedAt: new Date() },
        wallets: [{
          id: WALLET_ID,
          address: 'EQ_TEST',
          rawAddress: '0:abc',
          network: 'testnet',
          publicKey: 'public-key',
          isPrimary: true,
          verifiedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }],
        linkedSocials: [{ id: 'social-1', provider: 'telegram', providerUserId: '42', username: 'miner' }],
        session: { id: SESSION_ID, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() }
      }),
      logout: async () => ({ revoked: true })
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: await authHeader(config) }
  });

  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.user.id, USER_ID);
  assert.equal(data.wallets[0].address, 'EQ_TEST');
  assert.equal(data.linkedSocials[0].provider, 'telegram');
  assert.equal(data.session.id, SESSION_ID);
  assert.equal(JSON.stringify(data).includes('tokenHash'), false);
  assert.equal(JSON.stringify(data).includes('token":"'), false);

  await app.close();
});

test('POST /api/auth/logout revokes current session and records auth access path', async () => {
  const config = testConfig();
  const calls = [];
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    authService: {
      authenticate: async () => ({ ok: true, userId: USER_ID, sessionId: SESSION_ID, walletAddress: 'EQ_TEST' }),
      getCurrentUser: async () => null,
      logout: async (input) => {
        calls.push(input);
        return { revoked: true };
      }
    }
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { authorization: await authHeader(config) },
    payload: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.loggedOut, true);
  assert.equal(response.json().data.revoked, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, USER_ID);
  assert.equal(calls[0].sessionId, SESSION_ID);

  await app.close();
});

test('JWT auth checks active DB session and blocks revoked sessions', async () => {
  const config = testConfig();
  const authorization = await authHeader(config);
  const result = await authenticateRequest(
    { headers: { authorization } },
    config,
    { validateSession: async () => ({ ok: false, reason: 'revoked' }) }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_auth');
});

test('expired JWT is blocked before route access', async () => {
  const config = { ...testConfig(), sessionTtlSeconds: 1 };
  const { token } = await signSessionToken({
    userId: USER_ID,
    sessionId: SESSION_ID,
    walletAddress: 'EQ_TEST',
    config,
    now: new Date('2020-01-01T00:00:00.000Z')
  });

  const result = await authenticateRequest(
    { headers: { authorization: `Bearer ${token}` } },
    config,
    { validateSession: async () => ({ ok: true }) }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_auth');
});

test('revoked session cannot access /api/game/state', async () => {
  const config = testConfig();
  const app = await buildServer(config, {
    dbBundle: {},
    redis: fakeRedis(),
    authService: {
      authenticate: async () => ({ ok: false, code: 'invalid_auth', message: 'Invalid or expired session token' })
    },
    gameService: {
      async getState() {
        throw new Error('game state must not be called');
      },
      async sync() {
        throw new Error('not used');
      }
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/game/state',
    headers: { authorization: await authHeader(config) }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'invalid_auth');

  await app.close();
});
