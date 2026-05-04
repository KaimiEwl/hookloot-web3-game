import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeSlots,
  auditLogs,
  authEvents,
  boostStates,
  gameAccounts,
  idempotencyKeys,
  inventories,
  ledgerEvents,
  linkedSocials,
  paymentMonitorCheckpoints,
  paymentOrders,
  payments,
  referrals,
  sessions,
  tasks,
  userTasks,
  users,
  wallets,
  withdrawalRequests
} from '../src/db/schema.js';
import { loadConfig } from '../src/config.js';

test('server config validates required production values', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3101',
    PUBLIC_APP_ORIGIN: 'https://demo.example.com',
    TON_PROOF_DOMAIN: 'demo.example.com',
    JWT_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db',
    REDIS_URL: 'redis://127.0.0.1:6379/0'
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3101);
  assert.equal(config.tonProofDomain, 'demo.example.com');
  assert.equal(config.tonNetwork, 'testnet');
  assert.equal(config.tonIndexerUrl, 'https://testnet.tonapi.io/v2');
  assert.deepEqual(config.corsOrigins, ['https://demo.example.com']);
  assert.equal(config.telegramInitDataTtlSeconds, 86400);
  assert.equal(config.rateLimitAuthMax, 30);
  assert.equal(config.rateLimitActionsMax, 120);
});

test('foundation schema exposes users wallets sessions and auth events tables', () => {
  assert.equal(users[Symbol.for('drizzle:Name')], 'users');
  assert.equal(wallets[Symbol.for('drizzle:Name')], 'wallets');
  assert.equal(sessions[Symbol.for('drizzle:Name')], 'sessions');
  assert.equal(authEvents[Symbol.for('drizzle:Name')], 'auth_events');
  assert.equal(idempotencyKeys[Symbol.for('drizzle:Name')], 'idempotency_keys');
  assert.equal(gameAccounts[Symbol.for('drizzle:Name')], 'game_accounts');
  assert.equal(inventories[Symbol.for('drizzle:Name')], 'inventories');
  assert.equal(activeSlots[Symbol.for('drizzle:Name')], 'active_slots');
  assert.equal(boostStates[Symbol.for('drizzle:Name')], 'boost_states');
  assert.equal(ledgerEvents[Symbol.for('drizzle:Name')], 'ledger_events');
  assert.equal(paymentOrders[Symbol.for('drizzle:Name')], 'payment_orders');
  assert.equal(payments[Symbol.for('drizzle:Name')], 'payments');
  assert.equal(withdrawalRequests[Symbol.for('drizzle:Name')], 'withdrawal_requests');
  assert.equal(paymentMonitorCheckpoints[Symbol.for('drizzle:Name')], 'payment_monitor_checkpoints');
  assert.equal(linkedSocials[Symbol.for('drizzle:Name')], 'linked_socials');
  assert.equal(tasks[Symbol.for('drizzle:Name')], 'tasks');
  assert.equal(userTasks[Symbol.for('drizzle:Name')], 'user_tasks');
  assert.equal(referrals[Symbol.for('drizzle:Name')], 'referrals');
  assert.equal(auditLogs[Symbol.for('drizzle:Name')], 'audit_logs');
});
