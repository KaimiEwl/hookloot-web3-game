import Redis from 'ioredis';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3
});

const scanCount = Number(process.env.RATE_LIMIT_CLEANUP_SCAN_COUNT || 500);

async function scanRateKeys() {
  let cursor = '0';
  let scanned = 0;
  let deleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'rate:*', 'COUNT', scanCount);
    cursor = nextCursor;
    scanned += keys.length;

    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl < 0) {
        deleted += await redis.del(key);
      }
    }
  } while (cursor !== '0');

  return { scanned, deleted };
}

try {
  await redis.connect();
  const result = await scanRateKeys();
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await redis.quit();
}
