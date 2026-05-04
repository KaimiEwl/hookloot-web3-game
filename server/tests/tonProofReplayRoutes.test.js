import test from 'node:test';
import assert from 'node:assert/strict';
import { beginCell, contractAddress, storeStateInit } from '@ton/ton';
import { keyPairFromSeed, sign } from '@ton/crypto';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildTonProofSigningMessage } from '../src/auth/tonProof.js';
import { createTonProofChallengeStore } from '../src/auth/challengeStore.js';

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
    TON_PROOF_TTL_SECONDS: '300',
    TON_PROOF_MAX_AGE_SECONDS: '900',
    ...overrides
  });
}

function createMemoryRedis() {
  const values = new Map();
  const expiries = new Map();

  function isExpired(key) {
    const expiresAt = expiries.get(key);
    return expiresAt && expiresAt <= Date.now();
  }

  return {
    async set(key, value, mode, ttlSeconds) {
      values.set(key, value);
      if (mode === 'EX') expiries.set(key, Date.now() + Number(ttlSeconds) * 1000);
      return 'OK';
    },
    async get(key) {
      if (isExpired(key)) return null;
      return values.has(key) ? values.get(key) : null;
    },
    async del(key) {
      const existed = values.delete(key);
      expiries.delete(key);
      return existed ? 1 : 0;
    },
    async eval(_script, _keysCount, key) {
      const value = await this.get(key);
      if (value) await this.del(key);
      return value;
    },
    async scan(cursor, _match, pattern) {
      const prefix = String(pattern || '').replace('*', '');
      const keys = [...values.keys()].filter((key) => key.startsWith(prefix));
      return ['0', cursor === '0' ? keys : []];
    },
    async incr(key) {
      const next = Number(values.get(key) || 0) + 1;
      values.set(key, String(next));
      return next;
    },
    async expire(key, ttlSeconds) {
      expiries.set(key, Date.now() + Number(ttlSeconds) * 1000);
      return 1;
    },
    async quit() {
      return 'OK';
    }
  };
}

function createEventDb(events = []) {
  return {
    insert(table) {
      return {
        values(value) {
          events.push({ table, value });
        }
      };
    }
  };
}

function createWalletStateInit(publicKey) {
  const code = beginCell().storeUint(0, 1).endCell();
  const data = beginCell()
    .storeUint(0, 32)
    .storeUint(698983191, 32)
    .storeBuffer(publicKey)
    .endCell();
  return { code, data };
}

function stateInitToBase64(stateInit) {
  return beginCell().store(storeStateInit(stateInit)).endCell().toBoc().toString('base64');
}

function createWallet(seedByte) {
  const keyPair = keyPairFromSeed(Buffer.alloc(32, seedByte));
  const stateInit = createWalletStateInit(keyPair.publicKey);
  const address = contractAddress(0, stateInit);
  return {
    keyPair,
    stateInit,
    address,
    friendlyAddress: address.toString({ bounceable: false, urlSafe: true }),
    publicKeyHex: Buffer.from(keyPair.publicKey).toString('hex')
  };
}

async function createProofBody({
  payload,
  seedByte = 7,
  addressOverride = null,
  domain = 'demo.example.com',
  timestamp = Math.floor(Date.now() / 1000),
  signatureOverride = null,
  publicKeyOverride = null
}) {
  const wallet = createWallet(seedByte);
  const proof = {
    timestamp,
    domain: { lengthBytes: Buffer.byteLength(domain), value: domain },
    payload,
    state_init: stateInitToBase64(wallet.stateInit)
  };
  const signingMessage = await buildTonProofSigningMessage({
    address: wallet.address,
    ...proof
  });
  proof.signature = signatureOverride ?? Buffer.from(sign(signingMessage, wallet.keyPair.secretKey)).toString('base64');

  return {
    address: addressOverride || wallet.friendlyAddress,
    network: 'testnet',
    public_key: publicKeyOverride || wallet.publicKeyHex,
    proof
  };
}

async function createApp(configOverrides = {}) {
  const config = testConfig(configOverrides);
  const redis = createMemoryRedis();
  const authSessions = [];
  const events = [];
  const app = await buildServer(config, {
    redis,
    dbBundle: createEventDb(events),
    authService: {
      authenticate: async () => ({ ok: false, code: 'missing_auth', message: 'not used' }),
      createOrUpdateWalletSession: async ({ wallet }) => {
        authSessions.push(wallet);
        return {
          token: 'server-session-token',
          expiresAt: new Date(Date.now() + 60_000),
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            walletAddress: wallet.address,
            network: wallet.network
          }
        };
      },
      getCurrentUser: async () => null,
      logout: async () => ({ revoked: false })
    }
  });
  return { app, redis, authSessions, events };
}

async function requestPayload(app, headers = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/payload',
    headers,
    payload: {}
  });
  assert.equal(response.statusCode, 200);
  return response.json().data.payload;
}

test('TON proof route accepts a valid server challenge once', async () => {
  const { app, authSessions } = await createApp();
  const payload = await requestPayload(app, { origin: 'https://demo.example.com' });
  const body = await createProofBody({ payload });

  const okResponse = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/verify',
    headers: { origin: 'https://demo.example.com' },
    payload: body
  });
  assert.equal(okResponse.statusCode, 200);
  assert.equal(okResponse.json().data.token, 'server-session-token');
  assert.equal(authSessions.length, 1);

  const replay = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/verify',
    headers: { origin: 'https://demo.example.com' },
    payload: body
  });
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().error.code, 'invalid_ton_proof');

  await app.close();
});

test('TON proof route rejects expired payload', async () => {
  const { app } = await createApp({ TON_PROOF_TTL_SECONDS: '1' });
  const payload = await requestPayload(app);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/verify',
    payload: await createProofBody({ payload })
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'invalid_ton_proof');

  await app.close();
});

test('TON proof route rejects wrong proof domain', async () => {
  const { app } = await createApp();
  const payload = await requestPayload(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/verify',
    payload: await createProofBody({ payload, domain: 'evil.example' })
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.details.reason, 'invalid_domain');

  await app.close();
});

test('TON proof route rejects another wallet address for signed proof', async () => {
  const { app } = await createApp();
  const payload = await requestPayload(app);
  const otherWallet = createWallet(9);
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/verify',
    payload: await createProofBody({
      payload,
      seedByte: 7,
      addressOverride: otherWallet.friendlyAddress
    })
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.details.reason, 'address_mismatch');

  await app.close();
});

test('TON proof route rejects stale proof timestamp', async () => {
  const { app } = await createApp({ TON_PROOF_MAX_AGE_SECONDS: '60' });
  const payload = await requestPayload(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/verify',
    payload: await createProofBody({
      payload,
      timestamp: Math.floor(Date.now() / 1000) - 3600
    })
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.details.reason, 'stale_proof');

  await app.close();
});

test('TON proof route rejects malformed proof payload', async () => {
  const { app } = await createApp();
  const payload = await requestPayload(app);
  const body = await createProofBody({ payload });
  delete body.proof.signature;

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/ton/verify',
    payload: body
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'validation_error');

  await app.close();
});

test('TON proof challenge cleanup removes expired records', async () => {
  const redis = createMemoryRedis();
  const store = createTonProofChallengeStore(redis, { ttlSeconds: 300 });
  const now = new Date();
  await store.put('expired', { expiresAt: new Date(now.getTime() - 1000).toISOString() });
  await store.put('fresh', { expiresAt: new Date(now.getTime() + 60_000).toISOString() });

  const result = await store.cleanupExpired({ now });
  assert.equal(result.deleted, 1);
  assert.equal((await store.consume('expired', { now })).ok, false);
  assert.equal((await store.consume('fresh', { now })).ok, true);
});
