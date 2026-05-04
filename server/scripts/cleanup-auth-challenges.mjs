import Redis from 'ioredis';
import { loadConfig } from '../src/config.js';
import { createTonProofChallengeStore } from '../src/auth/challengeStore.js';

const config = loadConfig();
const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3
});

try {
  await redis.connect();
  const store = createTonProofChallengeStore(redis, {
    ttlSeconds: config.tonProofTtlSeconds
  });
  const result = await store.cleanupExpired({ now: new Date() });
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await redis.quit();
}
