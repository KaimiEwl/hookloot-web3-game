import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { cleanupExpiredSessions } from '../src/auth/repository.js';

const config = loadConfig();
const dbBundle = createDb(config.databaseUrl);

try {
  const result = await cleanupExpiredSessions(dbBundle.db || dbBundle, { now: new Date() });
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  if (dbBundle.pool) await dbBundle.pool.end();
}
