import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const serverRoot = join(root, 'server');

async function readAllMigrations() {
  const migrationsDir = join(serverRoot, 'drizzle');
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const contents = await Promise.all(files.map((file) => readFile(join(migrationsDir, file), 'utf8')));
  return contents.join('\n');
}

test('db hardening migration protects duplicate payments referrals active slots and negative balances', async () => {
  const sql = await readAllMigrations();

  assert.match(sql, /wallets_address_lower_unique/);
  assert.match(sql, /sessions_expires_at_idx/);
  assert.match(sql, /sessions_revoked_at_idx/);
  assert.match(sql, /idempotency_keys_user_scope_key_unique/);
  assert.match(sql, /payment_orders_user_status_expires_idx/);
  assert.match(sql, /payments_tx_hash_unique/);
  assert.match(sql, /payments_order_id_created_at_idx/);
  assert.match(sql, /linked_socials_provider_user_unique/);
  assert.match(sql, /linked_socials_user_provider_unique/);
  assert.match(sql, /user_tasks_user_task_unique/);
  assert.match(sql, /referrals_referred_user_unique/);
  assert.match(sql, /referrals_referrer_user_id_idx/);
  assert.match(sql, /audit_logs_user_event_type_created_at_idx/);
  assert.match(sql, /active_slots_user_slot_index_unique/);
  assert.match(sql, /active_slots_inventory_id_unique/);
  assert.match(sql, /game_accounts_balance_non_negative_check/);
  assert.match(sql, /withdrawal_requests_status_allowed_check/);
});

test('schema mirrors db hardening indexes and constraints for Drizzle checks', async () => {
  const schema = await readFile(join(serverRoot, 'src', 'db', 'schema.js'), 'utf8');

  assert.match(schema, /wallets_address_lower_unique/);
  assert.match(schema, /idempotency_keys_user_scope_key_unique/);
  assert.match(schema, /game_accounts_balance_non_negative_check/);
  assert.match(schema, /active_slots_inventory_id_unique/);
  assert.match(schema, /payment_orders_user_status_expires_idx/);
  assert.match(schema, /payments_tx_hash_unique/);
  assert.match(schema, /referrals_referred_user_unique/);
  assert.match(schema, /withdrawal_requests_status_allowed_check/);
});

test('cleanup scripts exist for expired durable and redis state', async () => {
  const scriptsDir = join(serverRoot, 'scripts');
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

  await Promise.all([
    readFile(join(scriptsDir, 'cleanup-sessions.mjs'), 'utf8'),
    readFile(join(scriptsDir, 'cleanup-auth-challenges.mjs'), 'utf8'),
    readFile(join(scriptsDir, 'cleanup-idempotency-keys.mjs'), 'utf8'),
    readFile(join(scriptsDir, 'cleanup-payment-orders.mjs'), 'utf8'),
    readFile(join(scriptsDir, 'cleanup-rate-limit-keys.mjs'), 'utf8')
  ]);

  assert.equal(packageJson.scripts['server:cleanup:sessions'], 'node server/scripts/cleanup-sessions.mjs');
  assert.equal(packageJson.scripts['server:cleanup:auth-challenges'], 'node server/scripts/cleanup-auth-challenges.mjs');
  assert.equal(packageJson.scripts['server:cleanup:idempotency'], 'node server/scripts/cleanup-idempotency-keys.mjs');
  assert.equal(packageJson.scripts['server:cleanup:payment-orders'], 'node server/scripts/cleanup-payment-orders.mjs');
  assert.equal(packageJson.scripts['server:cleanup:rate-limits'], 'node server/scripts/cleanup-rate-limit-keys.mjs');
});
