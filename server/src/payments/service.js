import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  paymentOrders,
  payments,
  wallets,
  withdrawalRequests
} from '../db/schema.js';
import { ActionError } from '../lib/actionErrors.js';
import { runIdempotentAction } from '../lib/idempotencyStore.js';
import {
  PAYMENT_CATALOG_VERSION,
  buildPaymentPayload,
  buildTonConnectTransaction,
  getPaymentCatalogItem
} from './catalog.js';
import {
  normalizeIncomingPaymentTransaction,
  sameWalletAddress,
  validateIncomingPayment
} from './transactions.js';
import {
  buildAuthoritativeStateInTx,
  persistMiningAccrualInTx
} from '../game/repository.js';
import { grantCatalogItemInTx } from '../game/service.js';
import { serializeGameState } from '../game/serialize.js';
import { serializePayment, serializePaymentOrder, serializeWithdrawal } from './serialize.js';
import { recordAuditLog } from '../lib/audit.js';

function toBigInt(value) {
  return typeof value === 'bigint' ? value : BigInt(value || 0);
}

function assertPaymentReceiver(config) {
  const receiver = String(config.paymentReceiverWalletAddress || '').trim();
  if (!receiver) {
    throw new ActionError('payment_receiver_not_configured', 'Payment receiver wallet is not configured', {
      statusCode: 503
    });
  }
  return receiver;
}

function assertPaymentItem(itemId) {
  const item = getPaymentCatalogItem(itemId);
  if (!item) {
    throw new ActionError('unknown_payment_item', 'Unknown payment item', {
      statusCode: 400,
      details: { itemId }
    });
  }
  return item;
}

function assertLinkedWallet(authWalletAddress) {
  const walletAddress = String(authWalletAddress || '').trim();
  if (!walletAddress) {
    throw new ActionError('linked_wallet_required', 'Connect TON wallet before payment action', {
      statusCode: 401
    });
  }
  return walletAddress;
}

async function findPrimaryWallet(tx, userId) {
  const [wallet] = await tx
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.isPrimary, true)))
    .limit(1);
  return wallet || null;
}

async function getUserOrder(tx, { userId, orderId }) {
  const [order] = await tx
    .select()
    .from(paymentOrders)
    .where(and(eq(paymentOrders.userId, userId), eq(paymentOrders.orderId, orderId)))
    .limit(1);
  return order || null;
}

async function maybeExpireOrder(tx, order, now) {
  if (!order || order.status !== 'pending' || new Date(order.expiresAt).getTime() > now.getTime()) {
    return order;
  }
  const [updated] = await tx
    .update(paymentOrders)
    .set({ status: 'expired', updatedAt: now })
    .where(eq(paymentOrders.id, order.id))
    .returning();
  return updated || { ...order, status: 'expired', updatedAt: now };
}

async function sumDailyWithdrawals(tx, { userId, since }) {
  const [row] = await tx
    .select({ total: sql`coalesce(sum(${withdrawalRequests.amountUnits}), 0)` })
    .from(withdrawalRequests)
    .where(and(
      eq(withdrawalRequests.userId, userId),
      gte(withdrawalRequests.createdAt, since)
    ));
  return toBigInt(row?.total || 0);
}

async function creditPaymentOrderInTx(tx, {
  order,
  incomingTx,
  config,
  now = new Date()
}) {
  if (!order) return { credited: false, reason: 'order_not_found' };

  const [existingPayment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.txHash, incomingTx.txHash))
    .for('update')
    .limit(1);
  if (existingPayment) {
    return {
      credited: false,
      reason: 'duplicate_tx_hash',
      order: serializePaymentOrder(order),
      payment: serializePayment(existingPayment)
    };
  }

  const [lockedOrder] = await tx
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.orderId, order.orderId))
    .for('update')
    .limit(1);
  if (!lockedOrder) return { credited: false, reason: 'order_not_found' };
  if (lockedOrder.status === 'paid') {
    return { credited: false, reason: 'order_already_paid', order: serializePaymentOrder(lockedOrder) };
  }

  const primaryWallet = await findPrimaryWallet(tx, lockedOrder.userId);
  const validation = validateIncomingPayment({
    order: lockedOrder,
    tx: incomingTx,
    linkedWalletAddress: primaryWallet?.address || null,
    allowGifts: false,
    now
  });

  if (!validation.ok) {
    if (validation.reason === 'order_expired') {
      await tx
        .update(paymentOrders)
        .set({ status: 'expired', updatedAt: now })
        .where(eq(paymentOrders.id, lockedOrder.id));
    }
    return { credited: false, reason: validation.reason, order: serializePaymentOrder(lockedOrder) };
  }

  await persistMiningAccrualInTx(tx, {
    userId: lockedOrder.userId,
    now,
    config,
    source: 'payment_order',
    sourceId: lockedOrder.orderId,
    idempotencyKey: lockedOrder.idempotencyKey || null
  });

  const paymentItem = assertPaymentItem(lockedOrder.itemId);

  const [payment] = await tx.insert(payments).values({
    orderId: lockedOrder.orderId,
    userId: lockedOrder.userId,
    txHash: incomingTx.txHash,
    txLt: incomingTx.txLt || null,
    senderWallet: incomingTx.senderWallet || null,
    receiverWallet: incomingTx.receiverWallet,
    assetType: incomingTx.assetType,
    jettonContract: incomingTx.jettonContract || null,
    amountUnits: incomingTx.amountUnits,
    payload: incomingTx.payload,
    status: 'confirmed',
    rawTx: incomingTx.rawTx || null,
    confirmedAt: incomingTx.confirmedAt || now
  }).returning();

  const grantResult = await grantCatalogItemInTx(tx, {
    userId: lockedOrder.userId,
    grant: paymentItem.grant,
    now,
    source: 'payment_order',
    sourceId: lockedOrder.orderId,
    idempotencyKey: lockedOrder.idempotencyKey || null,
    metadata: {
      paymentTxHash: incomingTx.txHash,
      paymentAmountUnits: incomingTx.amountUnits.toString(),
      paymentAssetType: incomingTx.assetType,
      paymentCatalogVersion: PAYMENT_CATALOG_VERSION
    }
  });

  const [paidOrder] = await tx
    .update(paymentOrders)
    .set({
      status: 'paid',
      updatedAt: now
    })
    .where(eq(paymentOrders.id, lockedOrder.id))
    .returning();

  await recordAuditLog(tx, {
    userId: lockedOrder.userId,
    eventType: 'payment_order_paid',
    actorType: 'worker',
    metadata: {
      orderId: lockedOrder.orderId,
      txHash: incomingTx.txHash,
      itemId: lockedOrder.itemId,
      amountUnits: incomingTx.amountUnits.toString()
    },
    now
  });

  const state = await buildAuthoritativeStateInTx(tx, {
    userId: lockedOrder.userId,
    now,
    config,
    lock: true
  });

  return {
    credited: true,
    reason: null,
    order: serializePaymentOrder(paidOrder || { ...lockedOrder, status: 'paid', updatedAt: now }),
    payment: serializePayment(payment),
    grant: grantResult,
    state: serializeGameState(state)
  };
}

export function createPaymentsService(db, config) {
  return {
    async createOrder({ userId, walletAddress, itemId, now = new Date(), idempotency, request = null }) {
      assertLinkedWallet(walletAddress);
      const item = assertPaymentItem(itemId);
      const receiverWallet = assertPaymentReceiver(config);

      return db.transaction(async (tx) => runIdempotentAction(tx, {
        userId,
        route: '/api/payments/orders',
        scope: `payment_order:${userId}`,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        now,
        run: async () => {
          const orderId = randomUUID();
          const payload = buildPaymentPayload({ network: config.tonNetwork, orderId });
          const expiresAt = new Date(now.getTime() + Number(config.paymentOrderTtlSeconds) * 1000);

          const [order] = await tx.insert(paymentOrders).values({
            orderId,
            userId,
            itemId: item.itemId,
            expectedAmountUnits: item.expectedAmountUnits,
            assetType: item.assetType,
            jettonContract: item.jettonContract || null,
            receiverWallet,
            payload,
            status: 'pending',
            expiresAt,
            idempotencyKey: idempotency.key,
            metadata: {
              catalogVersion: PAYMENT_CATALOG_VERSION,
              title: item.title,
              network: config.tonNetwork,
              grant: item.grant
            },
            createdAt: now,
            updatedAt: now
          }).returning();

          const serializedOrder = serializePaymentOrder(order);
          await recordAuditLog(tx, {
            userId,
            eventType: 'payment_order_created',
            actorType: 'user',
            request,
            metadata: {
              orderId,
              itemId: item.itemId,
              amountUnits: item.expectedAmountUnits.toString(),
              assetType: item.assetType
            },
            now
          });
          return {
            order: serializedOrder,
            transaction: buildTonConnectTransaction({
              order: serializedOrder,
              network: config.tonNetwork
            }),
            expiresAt: serializedOrder.expiresAt
          };
        }
      }));
    },

    async getOrder({ userId, orderId, now = new Date() }) {
      return db.transaction(async (tx) => {
        const order = await getUserOrder(tx, { userId, orderId });
        if (!order) {
          throw new ActionError('payment_order_not_found', 'Payment order was not found', {
            statusCode: 404
          });
        }
        const normalizedOrder = await maybeExpireOrder(tx, order, now);
        const paymentRows = await tx
          .select()
          .from(payments)
          .where(eq(payments.orderId, normalizedOrder.orderId));
        return {
          order: serializePaymentOrder(normalizedOrder),
          payments: paymentRows.map(serializePayment)
        };
      });
    },

    async createWithdrawal({ userId, walletAddress, amountUnits, assetType, destinationWallet, now = new Date(), idempotency, request = null }) {
      const linkedWallet = assertLinkedWallet(walletAddress);
      if (!sameWalletAddress(linkedWallet, destinationWallet)) {
        throw new ActionError('destination_wallet_mismatch', 'Withdrawal destination must be the linked wallet', {
          statusCode: 409
        });
      }

      const amount = toBigInt(amountUnits);
      if (amount <= 0n) {
        throw new ActionError('invalid_withdrawal_amount', 'Withdrawal amount must be positive', {
          statusCode: 400
        });
      }

      return db.transaction(async (tx) => runIdempotentAction(tx, {
        userId,
        route: '/api/withdrawals',
        scope: `withdrawal:${userId}`,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        now,
        run: async () => {
          const dayStart = new Date(now);
          dayStart.setUTCHours(0, 0, 0, 0);
          const dailyLimit = toBigInt(config.dailyWithdrawalLimitUnits || 0n);
          if (dailyLimit > 0n) {
            const usedToday = await sumDailyWithdrawals(tx, { userId, since: dayStart });
            if (usedToday + amount > dailyLimit) {
              throw new ActionError('daily_withdrawal_limit', 'Daily withdrawal limit exceeded', {
                statusCode: 409,
                details: {
                  usedUnits: usedToday.toString(),
                  requestedUnits: amount.toString(),
                  limitUnits: dailyLimit.toString()
                }
              });
            }
          }

          const [withdrawal] = await tx.insert(withdrawalRequests).values({
            userId,
            amountUnits: amount,
            assetType,
            destinationWallet,
            status: 'pending',
            reason: 'manual_review_required',
            metadata: {
              note: 'Stage 5 skeleton only. No private key and no automatic payout.',
              idempotencyKey: idempotency.key
            },
            createdAt: now,
            updatedAt: now
          }).returning();

          await recordAuditLog(tx, {
            userId,
            eventType: 'withdrawal_requested',
            actorType: 'user',
            request,
            metadata: {
              withdrawalId: withdrawal.id,
              amountUnits: amount.toString(),
              assetType
            },
            now
          });

          return { withdrawal: serializeWithdrawal(withdrawal) };
        }
      }));
    },

    async creditIncomingTransaction({ rawTx, now = new Date() }) {
      const incomingTx = normalizeIncomingPaymentTransaction(rawTx);
      if (!incomingTx.payload) return { credited: false, reason: 'missing_payload' };

      return db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(paymentOrders)
          .where(eq(paymentOrders.payload, incomingTx.payload))
          .limit(1);
        return creditPaymentOrderInTx(tx, { order, incomingTx, config, now });
      });
    },

    async creditPaymentOrderForTest({ order, tx: incomingTx, now = new Date() }) {
      return db.transaction(async (trx) => creditPaymentOrderInTx(trx, { order, incomingTx, config, now }));
    }
  };
}

export { creditPaymentOrderInTx };
