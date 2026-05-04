import { createHash } from 'node:crypto';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export function getIdempotencyKey(request) {
  const value = request.headers[IDEMPOTENCY_KEY_HEADER];
  const key = Array.isArray(value) ? value[0] : value;
  return typeof key === 'string' ? key.trim() : '';
}

export function validateIdempotencyKey(key) {
  if (!key) return { ok: false, reason: 'missing_idempotency_key' };
  if (key.length < 8 || key.length > 128) {
    return { ok: false, reason: 'invalid_idempotency_key_length' };
  }
  if (!/^[a-zA-Z0-9:._-]+$/.test(key)) {
    return { ok: false, reason: 'invalid_idempotency_key_format' };
  }
  return { ok: true, key };
}

export function createRequestHash(request) {
  const payload = {
    method: request.method,
    url: request.url,
    params: request.params ?? null,
    query: request.query ?? null,
    body: request.body ?? null
  };

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

export function parseIdempotency(request) {
  const key = getIdempotencyKey(request);
  const validation = validateIdempotencyKey(key);
  if (!validation.ok) return validation;
  return {
    ok: true,
    key: validation.key,
    requestHash: createRequestHash(request)
  };
}
