import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export function createDb(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return {
    pool,
    db: drizzle(pool, { schema })
  };
}
