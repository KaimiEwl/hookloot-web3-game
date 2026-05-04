import { and, eq, inArray } from 'drizzle-orm';
import {
  activeSlots,
  boostStates,
  gameAccounts,
  inventories,
  ledgerEvents
} from '../db/schema.js';
import {
  calculateIncomeUnitsPerHour,
  calculateIncomeUnitsPerSecond,
  calculateMiningDeltaUnits,
  normalizeRarityCounts
} from '../../../shared/domain/mining.js';

function toBigInt(value) {
  return typeof value === 'bigint' ? value : BigInt(value || 0);
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

async function ensureAccount(tx, userId, now) {
  await tx
    .insert(gameAccounts)
    .values({
      userId,
      balanceUnits: 0n,
      lastMinedAt: now,
      version: 0
    })
    .onConflictDoNothing({ target: gameAccounts.userId });

  const [account] = await tx
    .select()
    .from(gameAccounts)
    .where(eq(gameAccounts.userId, userId))
    .limit(1);

  return account;
}

export async function lockAccount(tx, userId, now) {
  await tx
    .insert(gameAccounts)
    .values({
      userId,
      balanceUnits: 0n,
      lastMinedAt: now,
      version: 0
    })
    .onConflictDoNothing({ target: gameAccounts.userId });

  const [account] = await tx
    .select()
    .from(gameAccounts)
    .where(eq(gameAccounts.userId, userId))
    .for('update')
    .limit(1);

  return account;
}

export async function loadEconomyRows(tx, userId) {
  const inventoryRows = await tx
    .select()
    .from(inventories)
    .where(eq(inventories.userId, userId));

  const slotRows = await tx
    .select()
    .from(activeSlots)
    .where(eq(activeSlots.userId, userId));

  const boostRows = await tx
    .select()
    .from(boostStates)
    .where(eq(boostStates.userId, userId));

  return { inventoryRows, slotRows, boostRows };
}

function buildActiveSlotState(slotRows, inventoryRows) {
  const inventoryById = new Map(inventoryRows.map((row) => [row.id, row]));
  const slots = slotRows
    .map((slot) => {
      const inventory = inventoryById.get(slot.inventoryId);
      if (!inventory) return null;
      return {
        id: slot.id,
        slotIndex: slot.slotIndex,
        inventoryId: slot.inventoryId,
        itemId: inventory.itemId,
        rarityId: inventory.rarityId,
        createdAt: slot.createdAt?.toISOString?.() || null,
        updatedAt: slot.updatedAt?.toISOString?.() || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.slotIndex - b.slotIndex);

  const counts = normalizeRarityCounts();
  for (const slot of slots) {
    if (slot.rarityId && counts[slot.rarityId] !== undefined) {
      counts[slot.rarityId] += 1;
    }
  }

  return { slots, counts };
}

function serializeInventoryRow(row) {
  return {
    id: row.id,
    itemId: row.itemId,
    rarityId: row.rarityId,
    quantity: row.quantity,
    metadata: row.metadata || null,
    createdAt: row.createdAt?.toISOString?.() || null,
    updatedAt: row.updatedAt?.toISOString?.() || null
  };
}

function serializeBoostRow(row) {
  return {
    id: row.id,
    boostType: row.boostType,
    level: row.level,
    activeUntil: row.activeUntil?.toISOString?.() || null,
    metadata: row.metadata || null,
    createdAt: row.createdAt?.toISOString?.() || null,
    updatedAt: row.updatedAt?.toISOString?.() || null
  };
}

export function buildState({ account, inventoryRows, slotRows, boostRows, now, config, projectedBalanceUnits = null }) {
  const activeSlotState = buildActiveSlotState(slotRows, inventoryRows);
  const incomeInput = {
    activeSlotCounts: activeSlotState.counts,
    boostStates: boostRows,
    now
  };
  const incomeUnitsPerSecond = calculateIncomeUnitsPerSecond(incomeInput);
  const incomeUnitsPerHour = calculateIncomeUnitsPerHour(incomeInput);
  const balanceUnits = projectedBalanceUnits ?? toBigInt(account.balanceUnits);
  const lastMinedAt = toDate(account.lastMinedAt);
  const nextPersistAt = new Date(lastMinedAt.getTime() + Number(config.miningPersistIntervalSeconds) * 1000);

  return {
    balanceUnits,
    inventory: inventoryRows.map(serializeInventoryRow),
    activeSlots: activeSlotState,
    activeSlotCounts: activeSlotState.counts,
    boosts: boostRows.map(serializeBoostRow),
    rawBoostStates: boostRows,
    incomeUnitsPerSecond,
    incomeUnitsPerHour,
    serverTime: now,
    lastMinedAt,
    nextPersistAt
  };
}

export function applyAccrualToLockedAccount({ account, activeSlotCounts, boostRows, now, config }) {
  const incomeUnitsPerSecond = calculateIncomeUnitsPerSecond({
    activeSlotCounts,
    boostStates: boostRows,
    now
  });
  const accrual = calculateMiningDeltaUnits({
    lastMinedAt: account.lastMinedAt,
    now,
    incomeUnitsPerSecond,
    maxOfflineSeconds: config.miningMaxOfflineSeconds
  });

  const balanceBefore = toBigInt(account.balanceUnits);
  const balanceAfter = balanceBefore + accrual.amountDeltaUnits;
  return {
    ...accrual,
    incomeUnitsPerSecond,
    balanceBefore,
    balanceAfter
  };
}

export function shouldWriteAccrualLedgerEvent(accrual) {
  return BigInt(accrual?.amountDeltaUnits || 0) > 0n;
}

export function buildMiningAccrualLedgerEvent({
  userId,
  accrual,
  source,
  sourceId = null,
  idempotencyKey = null
}) {
  if (!shouldWriteAccrualLedgerEvent(accrual)) return null;
  return {
    userId,
    eventType: 'mining_accrual',
    amountDelta: accrual.amountDeltaUnits,
    balanceBefore: accrual.balanceBefore,
    balanceAfter: accrual.balanceAfter,
    source,
    sourceId,
    idempotencyKey,
    metadata: {
      elapsedSeconds: accrual.elapsedSeconds,
      cappedSeconds: accrual.cappedSeconds,
      incomeUnitsPerSecond: accrual.incomeUnitsPerSecond.toString()
    }
  };
}

export async function getProjectedGameState(db, { userId, now = new Date(), config }) {
  return db.transaction(async (tx) => {
    const account = await ensureAccount(tx, userId, now);
    const { inventoryRows, slotRows, boostRows } = await loadEconomyRows(tx, userId);
    const state = buildState({ account, inventoryRows, slotRows, boostRows, now, config });

    const elapsedSeconds = Math.floor((now.getTime() - state.lastMinedAt.getTime()) / 1000);
    if (elapsedSeconds >= Number(config.miningPersistIntervalSeconds)) {
      return persistMiningAccrualInTx(tx, {
        userId,
        now,
        config,
        source: 'game_state',
        sourceId: now.toISOString()
      });
    }

    const projection = calculateMiningDeltaUnits({
      lastMinedAt: state.lastMinedAt,
      now,
      incomeUnitsPerSecond: state.incomeUnitsPerSecond,
      maxOfflineSeconds: config.miningMaxOfflineSeconds
    });

    return {
      ...state,
      balanceUnits: state.balanceUnits + projection.amountDeltaUnits
    };
  });
}

export async function persistMiningAccrualInTx(tx, {
  userId,
  now,
  config,
  source,
  sourceId = null,
  idempotencyKey = null
}) {
  const account = await lockAccount(tx, userId, now);
  const { inventoryRows, slotRows, boostRows } = await loadEconomyRows(tx, userId);
  const activeSlotState = buildActiveSlotState(slotRows, inventoryRows);
  const accrual = applyAccrualToLockedAccount({
    account,
    activeSlotCounts: activeSlotState.counts,
    boostRows,
    now,
    config
  });

  const shouldUpdateTimestamp = accrual.elapsedSeconds > 0;
  if (shouldUpdateTimestamp) {
    await tx
      .update(gameAccounts)
      .set({
        balanceUnits: accrual.balanceAfter,
        lastMinedAt: now,
        version: Number(account.version || 0) + 1,
        updatedAt: now
      })
      .where(eq(gameAccounts.userId, userId));
  }

  const ledgerEvent = buildMiningAccrualLedgerEvent({
    userId,
    accrual,
    source,
    sourceId,
    idempotencyKey
  });
  if (ledgerEvent) {
    await tx.insert(ledgerEvents).values(ledgerEvent);
  }

  const updatedAccount = {
    ...account,
    balanceUnits: accrual.balanceAfter,
    lastMinedAt: shouldUpdateTimestamp ? now : account.lastMinedAt,
    updatedAt: shouldUpdateTimestamp ? now : account.updatedAt,
    version: shouldUpdateTimestamp ? Number(account.version || 0) + 1 : account.version
  };

  return buildState({
    account: updatedAccount,
    inventoryRows,
    slotRows,
    boostRows,
    now,
    config
  });
}

export async function buildAuthoritativeStateInTx(tx, { userId, now = new Date(), config, lock = false }) {
  const account = lock ? await lockAccount(tx, userId, now) : await ensureAccount(tx, userId, now);
  const { inventoryRows, slotRows, boostRows } = await loadEconomyRows(tx, userId);
  return buildState({
    account,
    inventoryRows,
    slotRows,
    boostRows,
    now,
    config
  });
}

export async function persistMiningAccrual(db, {
  userId,
  now = new Date(),
  config,
  source = 'game_sync',
  sourceId = null,
  idempotencyKey = null
}) {
  return db.transaction(async (tx) => persistMiningAccrualInTx(tx, {
    userId,
    now,
    config,
    source,
    sourceId,
    idempotencyKey
  }));
}

export async function getInventoryTotals(db, { userId, itemIds }) {
  if (!itemIds?.length) return [];
  return db
    .select()
    .from(inventories)
    .where(and(eq(inventories.userId, userId), inArray(inventories.itemId, itemIds)));
}
