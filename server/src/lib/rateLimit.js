import { fail } from './responses.js';

const DEFAULT_WINDOW_SECONDS = 60;

function safeKeyPart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 120);
}

export async function checkRateLimit(redis, {
  key,
  max,
  windowSeconds = DEFAULT_WINDOW_SECONDS
}) {
  if (!redis || typeof redis.incr !== 'function' || !key || !max) {
    return { ok: true, remaining: Number(max || 0) };
  }

  const redisKey = `rate:${safeKeyPart(key)}`;
  const count = await redis.incr(redisKey);
  if (count === 1 && typeof redis.expire === 'function') {
    await redis.expire(redisKey, windowSeconds);
  }
  return {
    ok: count <= max,
    count,
    limit: max,
    remaining: Math.max(0, max - count),
    retryAfterSeconds: windowSeconds
  };
}

export async function requireRateLimit(fastify, request, reply, {
  scope,
  max,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
  userId = null
}) {
  const key = userId
    ? `${scope}:user:${userId}`
    : `${scope}:ip:${request.ip || 'unknown'}`;
  const result = await checkRateLimit(fastify.redis, { key, max, windowSeconds });
  if (result.ok) return true;
  reply.header('retry-after', String(result.retryAfterSeconds || windowSeconds));
  fail(reply, 429, 'rate_limited', 'Too many requests, please retry later', {
    limit: result.limit,
    retryAfterSeconds: result.retryAfterSeconds
  });
  return false;
}
