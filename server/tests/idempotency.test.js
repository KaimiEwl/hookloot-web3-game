import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRequestHash,
  getIdempotencyKey,
  parseIdempotency,
  validateIdempotencyKey
} from '../src/lib/idempotency.js';

test('idempotency key parser accepts stable action keys', () => {
  const request = {
    headers: {
      'idempotency-key': 'wallet-123:buy-common-001'
    },
    method: 'POST',
    url: '/api/actions/buy',
    params: {},
    query: {},
    body: { rarity: 'common' }
  };

  assert.equal(getIdempotencyKey(request), 'wallet-123:buy-common-001');
  const parsed = parseIdempotency(request);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.key, 'wallet-123:buy-common-001');
  assert.equal(parsed.requestHash, createRequestHash(request));
});

test('idempotency key validator rejects missing short or unsafe keys', () => {
  assert.deepEqual(validateIdempotencyKey(''), {
    ok: false,
    reason: 'missing_idempotency_key'
  });
  assert.deepEqual(validateIdempotencyKey('short'), {
    ok: false,
    reason: 'invalid_idempotency_key_length'
  });
  assert.deepEqual(validateIdempotencyKey('valid-length but spaces'), {
    ok: false,
    reason: 'invalid_idempotency_key_format'
  });
});
