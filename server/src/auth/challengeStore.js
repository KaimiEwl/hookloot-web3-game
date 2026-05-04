import { createHash } from 'node:crypto';

export function createTonProofChallengeStore(redis, { prefix = 'ton-proof', ttlSeconds = 300 } = {}) {
  function hashPayload(payload) {
    return createHash('sha256').update(String(payload || '')).digest('hex');
  }

  function key(payload) {
    return `${prefix}:${hashPayload(payload)}`;
  }

  function parseRecord(record, payload) {
    if (!record) return null;
    try {
      return JSON.parse(record);
    } catch {
      return {
        payload,
        challengeHash: hashPayload(payload)
      };
    }
  }

  async function atomicGetDelete(redisKey) {
    if (typeof redis.eval === 'function') {
      return redis.eval(
        "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v",
        1,
        redisKey
      );
    }

    const record = await redis.get(redisKey);
    if (record) await redis.del(redisKey);
    return record;
  }

  function isExpired(record, now = new Date()) {
    if (!record?.expiresAt) return false;
    return new Date(record.expiresAt).getTime() <= now.getTime();
  }

  return {
    async put(payload, value = {}) {
      const now = new Date();
      const record = JSON.stringify({
        challengeHash: hashPayload(payload),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + Number(ttlSeconds) * 1000).toISOString(),
        usedAt: null,
        walletAddress: null,
        ...value
      });
      await redis.set(key(payload), record, 'EX', ttlSeconds);
    },

    async consume(payload, { now = new Date(), origin = null } = {}) {
      const redisKey = key(payload);
      const rawRecord = await atomicGetDelete(redisKey);
      const record = parseRecord(rawRecord, payload);
      if (!record) return { ok: false, reason: 'payload_not_found' };
      if (isExpired(record, now)) return { ok: false, reason: 'payload_expired' };

      if (record.origin && origin && record.origin !== origin) {
        return { ok: false, reason: 'origin_mismatch' };
      }

      return { ok: true, record };
    },

    async cleanupExpired({ now = new Date(), scanCount = 100 } = {}) {
      if (typeof redis.scan !== 'function') {
        return { deleted: 0, ttlManaged: true };
      }

      let cursor = '0';
      let deleted = 0;
      do {
        const result = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', scanCount);
        cursor = String(result?.[0] || '0');
        const keys = result?.[1] || [];
        for (const redisKey of keys) {
          const record = parseRecord(await redis.get(redisKey), '');
          if (isExpired(record, now)) {
            await redis.del(redisKey);
            deleted += 1;
          }
        }
      } while (cursor !== '0');

      return { deleted, ttlManaged: true };
    }
  };
}
