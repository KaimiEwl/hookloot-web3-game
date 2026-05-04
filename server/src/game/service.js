import { and, eq, sql } from 'drizzle-orm';
import {
  activeSlots,
  boostStates,
  gameAccounts,
  inventories,
  ledgerEvents
} from '../db/schema.js';
import { ActionError } from '../lib/actionErrors.js';
import { runIdempotentAction } from '../lib/idempotencyStore.js';
import {
  ACTIVE_SLOT_COUNT,
  BOOST_TYPES,
  CATALOG_VERSION,
  COIN_BOOST_LEVELS,
  NFT_BOOST_PROGRESSION,
  NFT_ITEM_ID,
  RARITY_BY_ID
} from '../../../shared/domain/catalog.js';
import { buildNftBoostType } from '../../../shared/domain/mining.js';
import {
  buildAuthoritativeStateInTx,
  getProjectedGameState,
  persistMiningAccrualInTx
} from './repository.js';
import { serializeGameState } from './serialize.js';
import { qualifyReferralForUserInTx } from '../referrals/service.js';

function toBigInt(value) {
  return typeof value === 'bigint' ? value : BigInt(value || 0);
}

function asMoneyString(value) {
  return toBigInt(value).toString();
}

function assertRarity(rarityId) {
  const rarity = RARITY_BY_ID[rarityId];
  if (!rarity) {
    throw new ActionError('unknown_rarity', 'Unknown NFT rarity', {
      statusCode: 400,
      details: { rarityId }
    });
  }
  return rarity;
}

function assertNftItem(itemId) {
  if (itemId !== NFT_ITEM_ID) {
    throw new ActionError('unknown_item', 'Unknown item id', {
      statusCode: 400,
      details: { itemId }
    });
  }
}

function assertSlotIndex(slotIndex) {
  const value = Number(slotIndex);
  if (!Number.isInteger(value) || value < 0 || value >= ACTIVE_SLOT_COUNT) {
    throw new ActionError('invalid_slot', 'Invalid active slot index', {
      statusCode: 400,
      details: { slotIndex, min: 0, max: ACTIVE_SLOT_COUNT - 1 }
    });
  }
  return value;
}

function assertSufficientBalance(account, costUnits) {
  const balance = toBigInt(account.balanceUnits);
  if (balance < costUnits) {
    throw new ActionError('insufficient_balance', 'Not enough coins', {
      statusCode: 409,
      details: {
        balanceUnits: balance.toString(),
        requiredUnits: costUnits.toString()
      }
    });
  }
}

async function getLockedAccount(tx, userId) {
  const [account] = await tx
    .select()
    .from(gameAccounts)
    .where(eq(gameAccounts.userId, userId))
    .for('update')
    .limit(1);
  if (!account) throw new ActionError('account_not_found', 'Game account was not initialized', { statusCode: 500 });
  return account;
}

async function findInventory(tx, { userId, itemId, rarityId }) {
  const [row] = await tx
    .select()
    .from(inventories)
    .where(and(
      eq(inventories.userId, userId),
      eq(inventories.itemId, itemId),
      eq(inventories.rarityId, rarityId)
    ))
    .for('update')
    .limit(1);
  return row || null;
}

async function countActiveInventoryRows(tx, { userId, inventoryId }) {
  const rows = await tx
    .select()
    .from(activeSlots)
    .where(and(
      eq(activeSlots.userId, userId),
      eq(activeSlots.inventoryId, inventoryId)
    ));
  return rows.length;
}

async function writeLedger(tx, values) {
  await tx.insert(ledgerEvents).values({
    ...values,
    metadata: {
      catalogVersion: CATALOG_VERSION,
      ...(values.metadata || {})
    }
  });
}

function metadataForAction({ itemId, rarityId, slotIndex, costUnits, idempotencyKey }) {
  return {
    itemId,
    ...(rarityId ? { rarityId } : {}),
    ...(Number.isInteger(slotIndex) ? { slotIndex } : {}),
    ...(costUnits !== undefined ? { cost: asMoneyString(costUnits) } : {}),
    ...(idempotencyKey ? { idempotencyKey, source: 'idempotency_key' } : {})
  };
}

export async function grantCatalogItemInTx(tx, {
  userId,
  grant,
  now = new Date(),
  source = 'server_grant',
  sourceId = null,
  idempotencyKey = null,
  metadata = {}
}) {
  if (!grant || typeof grant !== 'object') {
    throw new ActionError('invalid_grant', 'Payment grant is invalid', { statusCode: 500 });
  }

  if (grant.type === 'nft') {
    assertNftItem(grant.itemId);
    assertRarity(grant.rarityId);
    const quantity = Math.max(1, Math.floor(Number(grant.quantity || 1)));
    const existing = await findInventory(tx, {
      userId,
      itemId: grant.itemId,
      rarityId: grant.rarityId
    });

    if (existing) {
      await tx
        .update(inventories)
        .set({
          quantity: sql`${inventories.quantity} + ${quantity}`,
          updatedAt: now
        })
        .where(eq(inventories.id, existing.id));
    } else {
      await tx.insert(inventories).values({
        userId,
        itemId: grant.itemId,
        rarityId: grant.rarityId,
        quantity,
        metadata: { catalogVersion: CATALOG_VERSION },
        createdAt: now,
        updatedAt: now
      });
    }

    await writeLedger(tx, {
      userId,
      eventType: 'payment_item_grant',
      amountDelta: 0n,
      source,
      sourceId,
      idempotencyKey,
      metadata: {
        ...metadataForAction({
          itemId: grant.itemId,
          rarityId: grant.rarityId,
          idempotencyKey
        }),
        quantity,
        ...metadata
      }
    });

    return {
      type: 'payment_item_grant',
      itemId: grant.itemId,
      rarityId: grant.rarityId,
      quantity
    };
  }

  if (grant.type === 'ton_boost') {
    const durationSeconds = Math.max(60, Math.floor(Number(grant.durationSeconds || 0)));
    const multiplier = Math.max(1, Number(grant.multiplier || 1));
    const boostType = BOOST_TYPES.TON_MULTIPLIER;
    const activeUntil = new Date(now.getTime() + durationSeconds * 1000);

    const [existingBoost] = await tx
      .select()
      .from(boostStates)
      .where(and(
        eq(boostStates.userId, userId),
        eq(boostStates.boostType, boostType)
      ))
      .for('update')
      .limit(1);

    const boostMetadata = {
      catalogVersion: CATALOG_VERSION,
      planId: String(grant.planId || ''),
      multiplier,
      durationSeconds
    };

    if (existingBoost) {
      await tx
        .update(boostStates)
        .set({
          level: 1,
          activeUntil,
          metadata: boostMetadata,
          updatedAt: now
        })
        .where(eq(boostStates.id, existingBoost.id));
    } else {
      await tx.insert(boostStates).values({
        userId,
        boostType,
        level: 1,
        activeUntil,
        metadata: boostMetadata,
        createdAt: now,
        updatedAt: now
      });
    }

    await writeLedger(tx, {
      userId,
      eventType: 'payment_boost_grant',
      amountDelta: 0n,
      source,
      sourceId,
      idempotencyKey,
      metadata: {
        boostType,
        activeUntil: activeUntil.toISOString(),
        ...boostMetadata,
        ...metadata
      }
    });

    return {
      type: 'payment_boost_grant',
      boostType,
      planId: boostMetadata.planId,
      multiplier,
      activeUntil: activeUntil.toISOString()
    };
  }

  throw new ActionError('unsupported_grant', 'Payment grant type is unsupported', {
    statusCode: 500,
    details: { type: grant.type }
  });
}

export function createGameService(db, config) {
  async function runAction({ userId, now, route, idempotency, action }) {
    return db.transaction(async (tx) => runIdempotentAction(tx, {
      userId,
      route,
      key: idempotency.key,
      requestHash: idempotency.requestHash,
      now,
      run: async () => {
        await persistMiningAccrualInTx(tx, {
          userId,
          now,
          config,
          source: route,
          sourceId: idempotency.key,
          idempotencyKey: idempotency.key
        });

        const result = await action(tx);
        const state = await buildAuthoritativeStateInTx(tx, { userId, now, config, lock: true });
        return {
          action: result,
          state: serializeGameState(state)
        };
      }
    }));
  }

  return {
    async getState({ userId, now = new Date() }) {
      const state = await getProjectedGameState(db, { userId, now, config });
      return serializeGameState(state);
    },

    async sync({ userId, now = new Date(), idempotencyKey = null }) {
      return db.transaction(async (tx) => {
        const state = await persistMiningAccrualInTx(tx, {
          userId,
          now,
          config,
          source: 'game_sync',
          sourceId: now.toISOString(),
          idempotencyKey
        });
        await qualifyReferralForUserInTx(tx, { userId, now });
        return serializeGameState(state);
      });
    },

    async buyShopItem({ userId, itemId, rarityId, now = new Date(), idempotency }) {
      assertNftItem(itemId);
      const rarity = assertRarity(rarityId);

      return runAction({
        userId,
        now,
        route: '/api/shop/buy',
        idempotency,
        action: async (tx) => {
          const account = await getLockedAccount(tx, userId);
          const costUnits = rarity.costUnits;
          assertSufficientBalance(account, costUnits);
          const balanceBefore = toBigInt(account.balanceUnits);
          const balanceAfter = balanceBefore - costUnits;

          await tx
            .update(gameAccounts)
            .set({
              balanceUnits: balanceAfter,
              updatedAt: now,
              version: Number(account.version || 0) + 1
            })
            .where(eq(gameAccounts.userId, userId));

          const existing = await findInventory(tx, { userId, itemId, rarityId });
          if (existing) {
            await tx
              .update(inventories)
              .set({
                quantity: sql`${inventories.quantity} + 1`,
                updatedAt: now
              })
              .where(eq(inventories.id, existing.id));
          } else {
            await tx.insert(inventories).values({
              userId,
              itemId,
              rarityId,
              quantity: 1,
              metadata: { catalogVersion: CATALOG_VERSION },
              createdAt: now,
              updatedAt: now
            });
          }

          await writeLedger(tx, {
            userId,
            eventType: 'shop_buy',
            amountDelta: -costUnits,
            balanceBefore,
            balanceAfter,
            source: 'shop',
            sourceId: `${itemId}:${rarityId}`,
            idempotencyKey: idempotency.key,
            metadata: metadataForAction({ itemId, rarityId, costUnits, idempotencyKey: idempotency.key })
          });

          return { type: 'shop_buy', itemId, rarityId, costUnits: costUnits.toString() };
        }
      });
    },

    async activateSlot({ userId, itemId, rarityId, slotIndex, now = new Date(), idempotency }) {
      assertNftItem(itemId);
      assertRarity(rarityId);
      const normalizedSlotIndex = assertSlotIndex(slotIndex);

      return runAction({
        userId,
        now,
        route: '/api/inventory/activate-slot',
        idempotency,
        action: async (tx) => {
          const inventory = await findInventory(tx, { userId, itemId, rarityId });
          if (!inventory || Number(inventory.quantity || 0) <= 0) {
            throw new ActionError('inventory_item_missing', 'NFT is not available in inventory', {
              statusCode: 409,
              details: { itemId, rarityId }
            });
          }

          const [existingSlot] = await tx
            .select()
            .from(activeSlots)
            .where(and(
              eq(activeSlots.userId, userId),
              eq(activeSlots.slotIndex, normalizedSlotIndex)
            ))
            .for('update')
            .limit(1);
          if (existingSlot) {
            throw new ActionError('slot_occupied', 'Active slot is already occupied', {
              statusCode: 409,
              details: { slotIndex: normalizedSlotIndex }
            });
          }

          const activeCount = await countActiveInventoryRows(tx, { userId, inventoryId: inventory.id });
          if (activeCount >= Number(inventory.quantity || 0)) {
            throw new ActionError('inventory_item_already_active', 'All NFTs from this inventory stack are already active', {
              statusCode: 409,
              details: { itemId, rarityId, quantity: inventory.quantity, activeCount }
            });
          }

          await tx.insert(activeSlots).values({
            userId,
            slotIndex: normalizedSlotIndex,
            inventoryId: inventory.id,
            createdAt: now,
            updatedAt: now
          });

          await writeLedger(tx, {
            userId,
            eventType: 'inventory_activate_slot',
            amountDelta: 0n,
            source: 'inventory',
            sourceId: `slot:${normalizedSlotIndex}`,
            idempotencyKey: idempotency.key,
            metadata: metadataForAction({
              itemId,
              rarityId,
              slotIndex: normalizedSlotIndex,
              idempotencyKey: idempotency.key
            })
          });

          return { type: 'inventory_activate_slot', itemId, rarityId, slotIndex: normalizedSlotIndex };
        }
      });
    },

    async removeSlot({ userId, slotIndex, now = new Date(), idempotency }) {
      const normalizedSlotIndex = assertSlotIndex(slotIndex);

      return runAction({
        userId,
        now,
        route: '/api/inventory/remove-slot',
        idempotency,
        action: async (tx) => {
          const [slot] = await tx
            .select()
            .from(activeSlots)
            .where(and(
              eq(activeSlots.userId, userId),
              eq(activeSlots.slotIndex, normalizedSlotIndex)
            ))
            .for('update')
            .limit(1);

          if (!slot) {
            throw new ActionError('slot_empty', 'Active slot is already empty', {
              statusCode: 409,
              details: { slotIndex: normalizedSlotIndex }
            });
          }

          await tx.delete(activeSlots).where(eq(activeSlots.id, slot.id));
          await writeLedger(tx, {
            userId,
            eventType: 'inventory_remove_slot',
            amountDelta: 0n,
            source: 'inventory',
            sourceId: `slot:${normalizedSlotIndex}`,
            idempotencyKey: idempotency.key,
            metadata: metadataForAction({
              slotIndex: normalizedSlotIndex,
              idempotencyKey: idempotency.key
            })
          });

          return { type: 'inventory_remove_slot', slotIndex: normalizedSlotIndex };
        }
      });
    },

    async activateCoinBoost({ userId, now = new Date(), idempotency }) {
      return runAction({
        userId,
        now,
        route: '/api/boosts/coin/activate',
        idempotency,
        action: async (tx) => {
          const [existingBoost] = await tx
            .select()
            .from(boostStates)
            .where(and(
              eq(boostStates.userId, userId),
              eq(boostStates.boostType, BOOST_TYPES.COIN)
            ))
            .for('update')
            .limit(1);
          const currentLevel = Math.max(0, Number(existingBoost?.level || 0));
          if (currentLevel >= COIN_BOOST_LEVELS.length) {
            throw new ActionError('boost_max_level', 'Coin boost is already max level', {
              statusCode: 409,
              details: { boostType: BOOST_TYPES.COIN, level: currentLevel }
            });
          }

          const next = COIN_BOOST_LEVELS[currentLevel];
          const costUnits = next.costUnits;
          const account = await getLockedAccount(tx, userId);
          assertSufficientBalance(account, costUnits);
          const balanceBefore = toBigInt(account.balanceUnits);
          const balanceAfter = balanceBefore - costUnits;

          await tx
            .update(gameAccounts)
            .set({
              balanceUnits: balanceAfter,
              updatedAt: now,
              version: Number(account.version || 0) + 1
            })
            .where(eq(gameAccounts.userId, userId));

          if (existingBoost) {
            await tx
              .update(boostStates)
              .set({
                level: next.level,
                metadata: { catalogVersion: CATALOG_VERSION },
                updatedAt: now
              })
              .where(eq(boostStates.id, existingBoost.id));
          } else {
            await tx.insert(boostStates).values({
              userId,
              boostType: BOOST_TYPES.COIN,
              level: next.level,
              metadata: { catalogVersion: CATALOG_VERSION },
              createdAt: now,
              updatedAt: now
            });
          }

          await writeLedger(tx, {
            userId,
            eventType: 'boost_coin_activate',
            amountDelta: -costUnits,
            balanceBefore,
            balanceAfter,
            source: 'boost',
            sourceId: BOOST_TYPES.COIN,
            idempotencyKey: idempotency.key,
            metadata: {
              ...metadataForAction({ costUnits, idempotencyKey: idempotency.key }),
              boostType: BOOST_TYPES.COIN,
              level: next.level
            }
          });

          return { type: 'boost_coin_activate', boostType: BOOST_TYPES.COIN, level: next.level, costUnits: costUnits.toString() };
        }
      });
    },

    async activateNftBoost({ userId, rarityId, now = new Date(), idempotency }) {
      assertRarity(rarityId);
      const boostConfig = NFT_BOOST_PROGRESSION[rarityId];
      const maxLevel = Number(boostConfig?.maxLevel || 10);
      const boostType = buildNftBoostType(rarityId);

      return runAction({
        userId,
        now,
        route: '/api/boosts/nft/activate',
        idempotency,
        action: async (tx) => {
          const inventory = await findInventory(tx, { userId, itemId: NFT_ITEM_ID, rarityId });
          const owned = Math.max(0, Number(inventory?.quantity || 0));
          const [existingBoost] = await tx
            .select()
            .from(boostStates)
            .where(and(
              eq(boostStates.userId, userId),
              eq(boostStates.boostType, boostType)
            ))
            .for('update')
            .limit(1);
          const currentLevel = Math.max(0, Number(existingBoost?.level || 0));
          if (currentLevel >= maxLevel) {
            throw new ActionError('boost_max_level', 'NFT boost is already max level', {
              statusCode: 409,
              details: { boostType, rarityId, level: currentLevel, maxLevel }
            });
          }

          const nextLevel = currentLevel + 1;
          if (owned < nextLevel) {
            throw new ActionError('nft_requirement_not_met', 'You need more NFTs to activate this boost', {
              statusCode: 409,
              details: {
                itemId: NFT_ITEM_ID,
                rarityId,
                owned,
                required: nextLevel,
                needed: nextLevel - owned
              }
            });
          }

          if (existingBoost) {
            await tx
              .update(boostStates)
              .set({
                level: nextLevel,
                metadata: { catalogVersion: CATALOG_VERSION, rarityId },
                updatedAt: now
              })
              .where(eq(boostStates.id, existingBoost.id));
          } else {
            await tx.insert(boostStates).values({
              userId,
              boostType,
              level: nextLevel,
              metadata: { catalogVersion: CATALOG_VERSION, rarityId },
              createdAt: now,
              updatedAt: now
            });
          }

          await writeLedger(tx, {
            userId,
            eventType: 'boost_nft_activate',
            amountDelta: 0n,
            source: 'boost',
            sourceId: boostType,
            idempotencyKey: idempotency.key,
            metadata: {
              ...metadataForAction({ itemId: NFT_ITEM_ID, rarityId, idempotencyKey: idempotency.key }),
              boostType,
              level: nextLevel,
              owned,
              required: nextLevel
            }
          });

          return { type: 'boost_nft_activate', boostType, rarityId, level: nextLevel };
        }
      });
    }
  };
}
