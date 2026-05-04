import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  rawAddress: text('raw_address').notNull(),
  network: text('network').notNull().default('mainnet'),
  publicKey: text('public_key').notNull(),
  isPrimary: boolean('is_primary').notNull().default(true),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  addressUnique: uniqueIndex('wallets_address_unique').on(table.address),
  addressLowerUnique: uniqueIndex('wallets_address_lower_unique').on(sql`lower(${table.address})`),
  rawAddressUnique: uniqueIndex('wallets_raw_address_unique').on(table.rawAddress),
  userIdx: index('wallets_user_id_idx').on(table.userId)
}));

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent'),
  ipHash: text('ip_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tokenHashUnique: uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
  userIdx: index('sessions_user_id_idx').on(table.userId),
  expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt),
  revokedAtIdx: index('sessions_revoked_at_idx').on(table.revokedAt),
  liveIdx: index('sessions_live_idx').on(table.userId).where(sql`${table.revokedAt} is null`)
}));

export const authEvents = pgTable('auth_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  walletAddress: text('wallet_address'),
  type: text('type').notNull(),
  ok: boolean('ok').notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  walletIdx: index('auth_events_wallet_idx').on(table.walletAddress),
  typeIdx: index('auth_events_type_idx').on(table.type),
  userCreatedAtIdx: index('auth_events_user_created_at_idx').on(table.userId, table.createdAt),
  typeCreatedAtIdx: index('auth_events_type_created_at_idx').on(table.type, table.createdAt)
}));

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  route: text('route').notNull(),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  response: jsonb('response'),
  status: text('status').notNull().default('started'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  scopeRouteKeyUnique: uniqueIndex('idempotency_keys_scope_route_key_unique')
    .on(table.scope, table.route, table.key),
  userScopeKeyUnique: uniqueIndex('idempotency_keys_user_scope_key_unique')
    .on(table.userId, table.scope, table.key)
    .where(sql`${table.userId} is not null`),
  userIdx: index('idempotency_keys_user_id_idx').on(table.userId),
  expiresAtIdx: index('idempotency_keys_expires_at_idx').on(table.expiresAt)
}));

export const gameAccounts = pgTable('game_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  balanceUnits: bigint('balance_units', { mode: 'bigint' }).notNull().default(0n),
  lastMinedAt: timestamp('last_mined_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userUnique: uniqueIndex('game_accounts_user_id_unique').on(table.userId),
  userIdx: index('game_accounts_user_id_idx').on(table.userId),
  balanceNonNegative: check('game_accounts_balance_non_negative_check', sql`${table.balanceUnits} >= 0`)
}));

export const inventories = pgTable('inventories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull(),
  rarityId: text('rarity_id'),
  quantity: integer('quantity').notNull().default(0),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userItemRarityUnique: uniqueIndex('inventories_user_item_rarity_unique')
    .on(table.userId, table.itemId, sql`coalesce(${table.rarityId}, '')`),
  userItemIdx: index('inventories_user_item_idx').on(table.userId, table.itemId),
  userIdx: index('inventories_user_id_idx').on(table.userId),
  quantityNonNegative: check('inventories_quantity_non_negative_check', sql`${table.quantity} >= 0`)
}));

export const activeSlots = pgTable('active_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  slotIndex: integer('slot_index').notNull(),
  inventoryId: uuid('inventory_id').notNull().references(() => inventories.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userSlotUnique: uniqueIndex('active_slots_user_slot_index_unique').on(table.userId, table.slotIndex),
  inventoryUnique: uniqueIndex('active_slots_inventory_id_unique').on(table.inventoryId),
  userSlotIdx: index('active_slots_user_slot_index_idx').on(table.userId, table.slotIndex),
  inventoryIdx: index('active_slots_inventory_id_idx').on(table.inventoryId)
}));

export const boostStates = pgTable('boost_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  boostType: text('boost_type').notNull(),
  level: integer('level').notNull().default(0),
  activeUntil: timestamp('active_until', { withTimezone: true }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userBoostTypeUnique: uniqueIndex('boost_states_user_boost_type_unique').on(table.userId, table.boostType),
  userBoostTypeIdx: index('boost_states_user_boost_type_idx').on(table.userId, table.boostType),
  levelNonNegative: check('boost_states_level_non_negative_check', sql`${table.level} >= 0`)
}));

export const ledgerEvents = pgTable('ledger_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  amountDelta: bigint('amount_delta', { mode: 'bigint' }).notNull().default(0n),
  balanceBefore: bigint('balance_before', { mode: 'bigint' }),
  balanceAfter: bigint('balance_after', { mode: 'bigint' }),
  source: text('source'),
  sourceId: text('source_id'),
  idempotencyKey: text('idempotency_key'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userCreatedAtIdx: index('ledger_events_user_created_at_idx').on(table.userId, table.createdAt),
  sourceSourceIdIdx: index('ledger_events_source_source_id_idx')
    .on(table.source, table.sourceId)
    .where(sql`${table.sourceId} is not null`)
}));

export const paymentOrders = pgTable('payment_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: text('order_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull(),
  expectedAmountUnits: bigint('expected_amount_units', { mode: 'bigint' }).notNull(),
  assetType: text('asset_type').notNull(),
  jettonContract: text('jetton_contract'),
  receiverWallet: text('receiver_wallet').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  idempotencyKey: text('idempotency_key'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  orderIdUnique: uniqueIndex('payment_orders_order_id_unique').on(table.orderId),
  payloadUnique: uniqueIndex('payment_orders_payload_unique').on(table.payload),
  userIdx: index('payment_orders_user_id_idx').on(table.userId),
  statusExpiresIdx: index('payment_orders_status_expires_idx').on(table.status, table.expiresAt),
  userStatusExpiresIdx: index('payment_orders_user_status_expires_idx').on(table.userId, table.status, table.expiresAt),
  userIdempotencyKeyUnique: uniqueIndex('payment_orders_user_id_idempotency_key_unique')
    .on(table.userId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} is not null`),
  expectedAmountPositive: check('payment_orders_expected_amount_positive_check', sql`${table.expectedAmountUnits} > 0`)
}));

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: text('order_id').notNull().references(() => paymentOrders.orderId, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  txHash: text('tx_hash').notNull(),
  txLt: text('tx_lt'),
  senderWallet: text('sender_wallet'),
  receiverWallet: text('receiver_wallet').notNull(),
  assetType: text('asset_type').notNull(),
  jettonContract: text('jetton_contract'),
  amountUnits: bigint('amount_units', { mode: 'bigint' }).notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull(),
  rawTx: jsonb('raw_tx'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  txHashUnique: uniqueIndex('payments_tx_hash_unique').on(table.txHash),
  orderIdx: index('payments_order_id_idx').on(table.orderId),
  orderCreatedAtIdx: index('payments_order_id_created_at_idx').on(table.orderId, table.createdAt),
  userCreatedAtIdx: index('payments_user_id_created_at_idx').on(table.userId, table.createdAt),
  amountPositive: check('payments_amount_positive_check', sql`${table.amountUnits} > 0`)
}));

export const withdrawalRequests = pgTable('withdrawal_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amountUnits: bigint('amount_units', { mode: 'bigint' }).notNull(),
  assetType: text('asset_type').notNull(),
  destinationWallet: text('destination_wallet').notNull(),
  status: text('status').notNull().default('pending'),
  reason: text('reason'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userCreatedAtIdx: index('withdrawal_requests_user_id_created_at_idx').on(table.userId, table.createdAt),
  statusIdx: index('withdrawal_requests_status_idx').on(table.status),
  statusCreatedAtIdx: index('withdrawal_requests_status_created_at_idx').on(table.status, table.createdAt),
  amountPositive: check('withdrawal_requests_amount_positive_check', sql`${table.amountUnits} > 0`),
  statusAllowed: check(
    'withdrawal_requests_status_allowed_check',
    sql`${table.status} in ('pending', 'under_review', 'approved_manual', 'rejected', 'cancelled', 'paid_external', 'failed')`
  )
}));

export const paymentMonitorCheckpoints = pgTable('payment_monitor_checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  network: text('network').notNull(),
  receiverWallet: text('receiver_wallet').notNull(),
  cursor: jsonb('cursor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  networkReceiverUnique: uniqueIndex('payment_monitor_checkpoints_network_receiver_unique')
    .on(table.network, table.receiverWallet),
  updatedAtIdx: index('payment_monitor_checkpoints_updated_at_idx').on(table.updatedAt)
}));

export const linkedSocials = pgTable('linked_socials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  username: text('username'),
  metadata: jsonb('metadata'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  providerUserUnique: uniqueIndex('linked_socials_provider_user_unique').on(table.provider, table.providerUserId),
  userProviderUnique: uniqueIndex('linked_socials_user_provider_unique').on(table.userId, table.provider),
  userIdx: index('linked_socials_user_id_idx').on(table.userId)
}));

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskCode: text('task_code').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull(),
  rewardUnits: bigint('reward_units', { mode: 'bigint' }).notNull().default(0n),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  taskCodeUnique: uniqueIndex('tasks_task_code_unique').on(table.taskCode),
  typeIdx: index('tasks_type_idx').on(table.type),
  activeIdx: index('tasks_active_idx').on(table.isActive)
}));

export const userTasks = pgTable('user_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userTaskUnique: uniqueIndex('user_tasks_user_task_unique').on(table.userId, table.taskId),
  userIdx: index('user_tasks_user_id_idx').on(table.userId)
}));

export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  referrerUserId: uuid('referrer_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  referredUserId: uuid('referred_user_id').references(() => users.id, { onDelete: 'cascade' }),
  referralCode: text('referral_code').notNull(),
  status: text('status').notNull().default('created'),
  qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
  rewardedAt: timestamp('rewarded_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  referralCodeUnique: uniqueIndex('referrals_referral_code_unique').on(table.referralCode),
  referrerCreatedUnique: uniqueIndex('referrals_referrer_created_unique')
    .on(table.referrerUserId)
    .where(sql`${table.referredUserId} is null and ${table.status} = 'created'`),
  referredUserUnique: uniqueIndex('referrals_referred_user_unique')
    .on(table.referredUserId)
    .where(sql`${table.referredUserId} is not null`),
  referrerIdx: index('referrals_referrer_user_id_idx').on(table.referrerUserId),
  referrerStatusIdx: index('referrals_referrer_status_idx').on(table.referrerUserId, table.status)
}));

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type'),
  ipHash: text('ip_hash'),
  userAgentHash: text('user_agent_hash'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userCreatedAtIdx: index('audit_logs_user_created_at_idx').on(table.userId, table.createdAt),
  eventTypeIdx: index('audit_logs_event_type_idx').on(table.eventType),
  userEventCreatedAtIdx: index('audit_logs_user_event_type_created_at_idx').on(table.userId, table.eventType, table.createdAt),
  actorEventCreatedAtIdx: index('audit_logs_actor_type_event_type_created_at_idx').on(table.actorType, table.eventType, table.createdAt)
}));
