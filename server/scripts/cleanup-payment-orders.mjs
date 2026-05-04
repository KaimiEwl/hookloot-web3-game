import { and, eq, lt } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { paymentOrders } from '../src/db/schema.js';

const config = loadConfig();
const dbBundle = createDb(config.databaseUrl);
const db = dbBundle.db || dbBundle;
const now = new Date();

try {
  const rows = await db
    .update(paymentOrders)
    .set({ status: 'expired', updatedAt: now })
    .where(and(
      eq(paymentOrders.status, 'pending'),
      lt(paymentOrders.expiresAt, now)
    ))
    .returning({ orderId: paymentOrders.orderId });

  console.log(JSON.stringify({ ok: true, expired: rows.length }));
} finally {
  if (dbBundle.pool) await dbBundle.pool.end();
}
