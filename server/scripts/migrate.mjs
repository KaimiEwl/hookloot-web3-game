import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(serverRoot, 'drizzle');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required to run server migrations.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

try {
  await client.query(`
    create table if not exists server_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const name of files) {
    const fullPath = join(migrationsDir, name);
    const sql = await readFile(fullPath, 'utf8');
    const checksum = sha256(sql);
    const applied = await client.query(
      'select checksum from server_migrations where name = $1',
      [name]
    );

    if (applied.rowCount > 0) {
      if (applied.rows[0].checksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${name}`);
      }
      console.log(`skip ${name}`);
      continue;
    }

    await client.query('begin');
    try {
      await client.query(sql);
      await client.query(
        'insert into server_migrations (name, checksum) values ($1, $2)',
        [name, checksum]
      );
      await client.query('commit');
      console.log(`applied ${name}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  console.log(`server migrations complete (${files.length} checked)`);
} finally {
  client.release();
  await pool.end();
}
