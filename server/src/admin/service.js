import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  activeSlots,
  auditLogs,
  boostStates,
  gameAccounts,
  inventories,
  ledgerEvents,
  paymentOrders,
  payments,
  referrals,
  tasks,
  userTasks,
  users,
  wallets,
  withdrawalRequests
} from '../db/schema.js';
import { recordAuditLog } from '../lib/audit.js';
import { ActionError } from '../lib/actionErrors.js';
import { runIdempotentAction } from '../lib/idempotencyStore.js';

export const WITHDRAWAL_STATUSES = Object.freeze([
  'pending',
  'under_review',
  'approved_manual',
  'rejected',
  'cancelled',
  'paid_external',
  'failed'
]);

const WITHDRAWAL_TRANSITIONS = Object.freeze({
  under_review: new Set(['pending']),
  rejected: new Set(['pending', 'under_review', 'approved_manual']),
  paid_external: new Set(['pending', 'under_review', 'approved_manual'])
});

export function canTransitionWithdrawalStatus(fromStatus, toStatus) {
  return Boolean(WITHDRAWAL_TRANSITIONS[toStatus]?.has(fromStatus));
}

function toOffset(cursor) {
  const value = Number(cursor || 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function serialize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

async function page(query, { limit = 25, cursor = '' } = {}) {
  const offset = toOffset(cursor);
  const rows = await query.limit(limit + 1).offset(offset);
  const hasMore = rows.length > limit;
  return {
    items: serialize(rows.slice(0, limit)),
    nextCursor: hasMore ? String(offset + limit) : null
  };
}

function searchPattern(query) {
  const value = String(query || '').trim();
  return value ? `%${value}%` : '';
}

function userSearchCondition(query) {
  const pattern = searchPattern(query);
  if (!pattern) return undefined;
  return or(
    sql`${users.id}::text ilike ${pattern}`,
    ilike(users.status, pattern),
    ilike(wallets.address, pattern),
    ilike(wallets.rawAddress, pattern)
  );
}

function orderSearchCondition(query) {
  const pattern = searchPattern(query);
  if (!pattern) return undefined;
  return or(
    ilike(paymentOrders.orderId, pattern),
    sql`${paymentOrders.userId}::text ilike ${pattern}`,
    ilike(paymentOrders.status, pattern),
    ilike(paymentOrders.itemId, pattern),
    ilike(paymentOrders.payload, pattern),
    ilike(paymentOrders.receiverWallet, pattern)
  );
}

function mergeWithdrawalMetadata(row, patch = {}) {
  return {
    ...(row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
    manualReview: {
      ...(row?.metadata?.manualReview && typeof row.metadata.manualReview === 'object'
        ? row.metadata.manualReview
        : {}),
      ...patch
    }
  };
}

export function createAdminService(db) {
  async function transitionWithdrawal({
    id,
    toStatus,
    reason = '',
    note = '',
    externalReference = '',
    admin = {},
    request = null,
    idempotency,
    now = new Date()
  }) {
    return db.transaction(async (tx) => runIdempotentAction(tx, {
      userId: admin?.userId || null,
      route: `/api/admin/withdrawals/${id}/${toStatus}`,
      scope: `admin_withdrawal:${id}`,
      key: idempotency.key,
      requestHash: idempotency.requestHash,
      now,
      run: async () => {
        const [current] = await tx
          .select()
          .from(withdrawalRequests)
          .where(eq(withdrawalRequests.id, id))
          .for('update')
          .limit(1);

        if (!current) {
          throw new ActionError('withdrawal_not_found', 'Withdrawal request not found', {
            statusCode: 404
          });
        }

        if (!canTransitionWithdrawalStatus(current.status, toStatus)) {
          throw new ActionError('invalid_withdrawal_transition', 'Withdrawal status transition is not allowed', {
            statusCode: 409,
            details: {
              from: current.status,
              to: toStatus
            }
          });
        }

        const metadata = mergeWithdrawalMetadata(current, {
          lastAction: toStatus,
          note: note || undefined,
          externalReference: externalReference || undefined,
          adminMethod: admin?.method || 'unknown',
          adminUserId: admin?.userId || undefined,
          adminWalletAddress: admin?.walletAddress || undefined,
          changedAt: now.toISOString()
        });

        const [updated] = await tx
          .update(withdrawalRequests)
          .set({
            status: toStatus,
            reason: reason || current.reason,
            metadata,
            updatedAt: now
          })
          .where(eq(withdrawalRequests.id, id))
          .returning();

        await recordAuditLog(tx, {
          userId: current.userId,
          actorType: 'admin',
          eventType: 'withdrawal_manual_status_changed',
          request,
          metadata: {
            withdrawalId: id,
            fromStatus: current.status,
            toStatus,
            reason: reason || undefined,
            note: note || undefined,
            externalReference: externalReference || undefined,
            adminMethod: admin?.method || 'unknown',
            adminWalletAddress: admin?.walletAddress || undefined
          },
          now
        });

        return {
          withdrawal: serialize(updated)
        };
      }
    }));
  }

  return {
    async recordAccess({ admin, request, route, metadata = {} }) {
      await recordAuditLog(db, {
        userId: admin?.userId || null,
        actorType: 'admin',
        eventType: 'admin_access',
        request,
        metadata: {
          route,
          method: admin?.method || 'unknown',
          adminWalletAddress: admin?.walletAddress || undefined,
          ...metadata
        }
      });
    },

    async listUsers({ query = '', limit = 25, cursor = '' } = {}) {
      const condition = userSearchCondition(query);
      const base = db
        .select({
          user: users,
          primaryWallet: wallets,
          gameAccount: gameAccounts
        })
        .from(users)
        .leftJoin(wallets, and(eq(wallets.userId, users.id), eq(wallets.isPrimary, true)))
        .leftJoin(gameAccounts, eq(gameAccounts.userId, users.id));

      const filtered = condition ? base.where(condition) : base;
      return page(filtered.orderBy(desc(users.createdAt)), { limit, cursor });
    },

    async getUser({ userId }) {
      const [summary] = await db
        .select({
          user: users,
          gameAccount: gameAccounts
        })
        .from(users)
        .leftJoin(gameAccounts, eq(gameAccounts.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1);

      if (!summary) return null;

      const [userWallets, inventory, slots, boosts] = await Promise.all([
        db.select().from(wallets).where(eq(wallets.userId, userId)).orderBy(desc(wallets.createdAt)),
        db.select().from(inventories).where(eq(inventories.userId, userId)).orderBy(desc(inventories.updatedAt)),
        db.select().from(activeSlots).where(eq(activeSlots.userId, userId)).orderBy(activeSlots.slotIndex),
        db.select().from(boostStates).where(eq(boostStates.userId, userId)).orderBy(boostStates.boostType)
      ]);

      return serialize({
        ...summary,
        wallets: userWallets,
        inventory,
        activeSlots: slots,
        boosts
      });
    },

    async getUserLedger({ userId, limit = 25, cursor = '' }) {
      return page(
        db.select().from(ledgerEvents).where(eq(ledgerEvents.userId, userId)).orderBy(desc(ledgerEvents.createdAt)),
        { limit, cursor }
      );
    },

    async getUserTasks({ userId, limit = 25, cursor = '' }) {
      return page(
        db
          .select({
            userTask: userTasks,
            task: tasks
          })
          .from(userTasks)
          .leftJoin(tasks, eq(tasks.id, userTasks.taskId))
          .where(eq(userTasks.userId, userId))
          .orderBy(desc(userTasks.updatedAt)),
        { limit, cursor }
      );
    },

    async getUserReferrals({ userId, limit = 25, cursor = '' }) {
      return page(
        db
          .select()
          .from(referrals)
          .where(or(eq(referrals.referrerUserId, userId), eq(referrals.referredUserId, userId)))
          .orderBy(desc(referrals.createdAt)),
        { limit, cursor }
      );
    },

    async listPaymentOrders({ query = '', limit = 25, cursor = '' } = {}) {
      const condition = orderSearchCondition(query);
      const base = db.select().from(paymentOrders);
      const filtered = condition ? base.where(condition) : base;
      return page(filtered.orderBy(desc(paymentOrders.createdAt)), { limit, cursor });
    },

    async getPayment({ orderId }) {
      const [order] = await db
        .select()
        .from(paymentOrders)
        .where(eq(paymentOrders.orderId, orderId))
        .limit(1);
      if (!order) return null;

      const orderPayments = await db
        .select()
        .from(payments)
        .where(eq(payments.orderId, orderId))
        .orderBy(desc(payments.createdAt));

      return serialize({ order, payments: orderPayments });
    },

    async listWithdrawals({ limit = 25, cursor = '' } = {}) {
      return page(
        db.select().from(withdrawalRequests).orderBy(desc(withdrawalRequests.createdAt)),
        { limit, cursor }
      );
    },

    async getWithdrawal({ id }) {
      const [withdrawal] = await db
        .select()
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.id, id))
        .limit(1);
      return serialize(withdrawal || null);
    },

    async markWithdrawalUnderReview(input) {
      return transitionWithdrawal({
        ...input,
        toStatus: 'under_review'
      });
    },

    async rejectWithdrawal(input) {
      return transitionWithdrawal({
        ...input,
        toStatus: 'rejected',
        reason: input.reason
      });
    },

    async markWithdrawalPaidExternal(input) {
      return transitionWithdrawal({
        ...input,
        toStatus: 'paid_external',
        note: input.note,
        externalReference: input.externalReference
      });
    },

    async listAuditLogs({ limit = 25, cursor = '' } = {}) {
      return page(
        db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)),
        { limit, cursor }
      );
    }
  };
}
