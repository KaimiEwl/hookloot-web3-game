import { and, eq } from 'drizzle-orm';
import {
  gameAccounts,
  inventories,
  ledgerEvents,
  linkedSocials,
  referrals,
  tasks,
  userTasks
} from '../db/schema.js';
import { ActionError } from '../lib/actionErrors.js';
import { runIdempotentAction } from '../lib/idempotencyStore.js';
import { persistMiningAccrualInTx, buildAuthoritativeStateInTx } from '../game/repository.js';
import { serializeGameState } from '../game/serialize.js';
import { createTelegramMembershipProvider } from '../telegram/provider.js';
import { SOCIAL_PROVIDERS } from '../social/service.js';
import { NFT_ITEM_ID } from '../../../shared/domain/catalog.js';
import { recordAuditLog } from '../lib/audit.js';

export const TASK_TYPES = {
  CONNECT_TELEGRAM: 'connect_telegram',
  SUBSCRIBE_CHANNEL: 'subscribe_channel',
  INVITE_FRIEND: 'invite_friend',
  OWN_NFT: 'own_nft'
};

export const DEFAULT_TASKS = [
  { taskCode: 'connect_telegram', title: 'Connect Telegram', type: TASK_TYPES.CONNECT_TELEGRAM },
  { taskCode: 'subscribe_channel', title: 'Subscribe to Telegram channel', type: TASK_TYPES.SUBSCRIBE_CHANNEL },
  { taskCode: 'invite_friend', title: 'Invite a friend', type: TASK_TYPES.INVITE_FRIEND },
  { taskCode: 'own_nft', title: 'Own NFT', type: TASK_TYPES.OWN_NFT }
];

function toBigInt(value) {
  return typeof value === 'bigint' ? value : BigInt(value || 0);
}

function serializeTask(task, userTask = null, readiness = null) {
  return {
    id: task.id,
    taskCode: task.taskCode,
    title: task.title,
    type: task.type,
    rewardUnits: toBigInt(task.rewardUnits).toString(),
    isActive: task.isActive,
    status: userTask?.status || 'pending',
    claimedAt: userTask?.claimedAt?.toISOString?.() || null,
    readiness,
    metadata: task.metadata || null
  };
}

async function ensureDefaultTasks(tx, { rewardUnits, now }) {
  for (const task of DEFAULT_TASKS) {
    await tx
      .insert(tasks)
      .values({
        ...task,
        rewardUnits,
        isActive: true,
        metadata: { system: true },
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing({ target: tasks.taskCode });
  }
}

async function getTelegramSocial(tx, userId) {
  const [row] = await tx
    .select()
    .from(linkedSocials)
    .where(and(
      eq(linkedSocials.userId, userId),
      eq(linkedSocials.provider, SOCIAL_PROVIDERS.TELEGRAM)
    ))
    .limit(1);
  return row || null;
}

export async function evaluateSubscribeChannelReadiness({ telegramSocial, telegramMembershipProvider }) {
  if (!telegramMembershipProvider?.configured) {
    return {
      ok: false,
      reason: 'not_configured',
      retryable: false,
      details: { missing: telegramMembershipProvider?.missing || [] }
    };
  }
  if (!telegramSocial) return { ok: false, reason: 'telegram_not_linked' };

  const member = await telegramMembershipProvider.checkMembership(telegramSocial.providerUserId);
  if (!member.ok) {
    return {
      ok: false,
      reason: member.reason,
      retryable: Boolean(member.retryable),
      details: {
        status: member.status || null,
        ...(member.details ? { provider: member.details } : {})
      }
    };
  }
  return member.isMember
    ? { ok: true, details: { status: member.status } }
    : { ok: false, reason: 'telegram_not_subscribed', details: { status: member.status } };
}

async function getTaskByIdOrCode(tx, taskId) {
  const value = String(taskId || '').trim();
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const where = uuidLike ? eq(tasks.id, value) : eq(tasks.taskCode, value);
  const [task] = await tx
    .select()
    .from(tasks)
    .where(where)
    .limit(1);
  return task || null;
}

async function getUserTask(tx, userId, taskId) {
  const [row] = await tx
    .select()
    .from(userTasks)
    .where(and(eq(userTasks.userId, userId), eq(userTasks.taskId, taskId)))
    .limit(1);
  return row || null;
}

async function evaluateTask(tx, task, { userId, telegramMembershipProvider }) {
  if (task.type === TASK_TYPES.CONNECT_TELEGRAM) {
    const social = await getTelegramSocial(tx, userId);
    return social ? { ok: true, details: { provider: SOCIAL_PROVIDERS.TELEGRAM } } : { ok: false, reason: 'telegram_not_linked' };
  }

  if (task.type === TASK_TYPES.SUBSCRIBE_CHANNEL) {
    const social = await getTelegramSocial(tx, userId);
    return evaluateSubscribeChannelReadiness({ telegramSocial: social, telegramMembershipProvider });
  }

  if (task.type === TASK_TYPES.INVITE_FRIEND) {
    const [referral] = await tx
      .select()
      .from(referrals)
      .where(and(
        eq(referrals.referrerUserId, userId),
        eq(referrals.status, 'qualified')
      ))
      .for('update')
      .limit(1);
    return referral ? { ok: true, details: { referralId: referral.id } } : { ok: false, reason: 'qualified_referral_missing' };
  }

  if (task.type === TASK_TYPES.OWN_NFT) {
    const [inventory] = await tx
      .select()
      .from(inventories)
      .where(and(eq(inventories.userId, userId), eq(inventories.itemId, NFT_ITEM_ID)))
      .limit(1);
    return inventory && Number(inventory.quantity || 0) > 0
      ? { ok: true, details: { itemId: NFT_ITEM_ID } }
      : { ok: false, reason: 'nft_missing' };
  }

  return { ok: false, reason: 'unsupported_task_type' };
}

async function rewardTaskInTx(tx, {
  userId,
  task,
  idempotencyKey,
  now,
  config,
  validation
}) {
  const rewardUnits = toBigInt(task.rewardUnits);
  await persistMiningAccrualInTx(tx, {
    userId,
    now,
    config,
    source: 'task_claim',
    sourceId: task.taskCode,
    idempotencyKey
  });

  const [account] = await tx
    .select()
    .from(gameAccounts)
    .where(eq(gameAccounts.userId, userId))
    .for('update')
    .limit(1);
  const balanceBefore = toBigInt(account?.balanceUnits || 0n);
  const balanceAfter = balanceBefore + rewardUnits;

  await tx
    .update(gameAccounts)
    .set({ balanceUnits: balanceAfter, updatedAt: now, version: Number(account?.version || 0) + 1 })
    .where(eq(gameAccounts.userId, userId));

  const [userTask] = await tx
    .insert(userTasks)
    .values({
      userId,
      taskId: task.id,
      status: 'claimed',
      claimedAt: now,
      metadata: { validation },
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [userTasks.userId, userTasks.taskId],
      set: {
        status: 'claimed',
        claimedAt: now,
        metadata: { validation },
        updatedAt: now
      }
    })
    .returning();

  if (task.type === TASK_TYPES.INVITE_FRIEND && validation?.details?.referralId) {
    await tx
      .update(referrals)
      .set({ status: 'rewarded', rewardedAt: now, updatedAt: now })
      .where(eq(referrals.id, validation.details.referralId));
  }

  await tx.insert(ledgerEvents).values({
    userId,
    eventType: 'task_reward',
    amountDelta: rewardUnits,
    balanceBefore,
    balanceAfter,
    source: 'task',
    sourceId: task.taskCode,
    idempotencyKey,
    metadata: {
      taskId: task.id,
      taskCode: task.taskCode,
      taskType: task.type,
      validation
    },
    createdAt: now
  });

  return userTask;
}

export function createTasksService(db, config, { fetchImpl = globalThis.fetch, telegramMembershipProvider = null } = {}) {
  const membershipProvider = telegramMembershipProvider || createTelegramMembershipProvider({
    botToken: config.telegramBotToken,
    apiBaseUrl: config.telegramBotApiBaseUrl,
    chatId: config.telegramRequiredChannelId,
    fetchImpl
  });

  return {
    async listTasks({ userId, now = new Date() }) {
      return db.transaction(async (tx) => {
        await ensureDefaultTasks(tx, { rewardUnits: config.taskRewardUnits, now });
        const taskRows = await tx.select().from(tasks);
        const userTaskRows = await tx.select().from(userTasks).where(eq(userTasks.userId, userId));
        const byTaskId = new Map(userTaskRows.map((row) => [row.taskId, row]));
        const items = [];
        for (const task of taskRows) {
          const readiness = task.isActive && byTaskId.get(task.id)?.status !== 'claimed'
            ? await evaluateTask(tx, task, { userId, telegramMembershipProvider: membershipProvider })
            : null;
          items.push(serializeTask(task, byTaskId.get(task.id), readiness));
        }
        return { tasks: items.sort((a, b) => a.taskCode.localeCompare(b.taskCode)) };
      });
    },

    async claimTask({ userId, taskId, now = new Date(), idempotency, request = null }) {
      return db.transaction(async (tx) => runIdempotentAction(tx, {
        userId,
        route: '/api/tasks/claim',
        scope: `task_claim:${userId}`,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        now,
        run: async () => {
          await ensureDefaultTasks(tx, { rewardUnits: config.taskRewardUnits, now });
          const task = await getTaskByIdOrCode(tx, taskId);
          if (!task || !task.isActive) {
            throw new ActionError('task_not_available', 'Task is not active or was not found', { statusCode: 404 });
          }

          const existing = await getUserTask(tx, userId, task.id);
          if (existing?.status === 'claimed') {
            const state = await buildAuthoritativeStateInTx(tx, { userId, now, config, lock: true });
            return {
              action: { type: 'task_already_claimed', task: serializeTask(task, existing) },
              state: serializeGameState(state)
            };
          }

          const validation = await evaluateTask(tx, task, { userId, telegramMembershipProvider: membershipProvider });
          if (!validation.ok) {
            await tx
              .insert(userTasks)
              .values({
                userId,
                taskId: task.id,
                status: 'pending',
                metadata: { lastRejectedReason: validation.reason, retryable: validation.retryable || false },
                createdAt: now,
                updatedAt: now
              })
              .onConflictDoUpdate({
                target: [userTasks.userId, userTasks.taskId],
                set: {
                  status: 'pending',
                  metadata: { lastRejectedReason: validation.reason, retryable: validation.retryable || false },
                  updatedAt: now
                }
              });
            await recordAuditLog(tx, {
              userId,
              eventType: 'task_verification_failed',
              actorType: 'user',
              request,
              metadata: { taskCode: task.taskCode, reason: validation.reason, retryable: validation.retryable || false },
              now
            });
            await recordAuditLog(tx, {
              userId,
              eventType: 'task_claim_rejected',
              actorType: 'user',
              request,
              metadata: { taskCode: task.taskCode, reason: validation.reason },
              now
            });
            throw new ActionError('task_condition_not_met', 'Task condition is not verified yet', {
              statusCode: validation.retryable ? 503 : 409,
              details: validation
            });
          }

          await recordAuditLog(tx, {
            userId,
            eventType: 'task_verification_succeeded',
            actorType: 'user',
            request,
            metadata: {
              taskCode: task.taskCode,
              taskType: task.type,
              details: validation.details || null
            },
            now
          });

          const userTask = await rewardTaskInTx(tx, {
            userId,
            task,
            idempotencyKey: idempotency.key,
            now,
            config,
            validation
          });
          await recordAuditLog(tx, {
            userId,
            eventType: 'task_claimed',
            actorType: 'user',
            request,
            metadata: { taskCode: task.taskCode, rewardUnits: task.rewardUnits.toString() },
            now
          });

          const state = await buildAuthoritativeStateInTx(tx, { userId, now, config, lock: true });
          return {
            action: { type: 'task_claimed', task: serializeTask(task, userTask, validation) },
            state: serializeGameState(state)
          };
        }
      }));
    }
  };
}
