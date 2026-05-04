import { sql } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { idempotencyKeys } from '../src/db/schema.js';

const config = loadConfig();
const dbBundle = createDb(config.databaseUrl);
const db = dbBundle.db || dbBundle;

try {
  const rows = await db
    .delete(idempotencyKeys)
    .where(sql`${idempotencyKeys.expiresAt} < now()`)
    .returning({ id: idempotencyKeys.id });

  console.log(JSON.stringify({ ok: true, deleted: rows.length }));
} finally {
  if (dbBundle.pool) await dbBundle.pool.end();
}
