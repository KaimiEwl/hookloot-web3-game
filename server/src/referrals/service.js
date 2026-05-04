import { randomBytes } from 'node:crypto';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { referrals } from '../db/schema.js';
import { ActionError } from '../lib/actionErrors.js';
import { runIdempotentAction } from '../lib/idempotencyStore.js';
import { recordAuditLog } from '../lib/audit.js';

function makeCode(prefix = 'ref') {
  return `${prefix}_${randomBytes(8).toString('base64url')}`;
}

function serializeReferral(row) {
  if (!row) return null;
  return {
    id: row.id,
    referrerUserId: row.referrerUserId,
    referredUserId: row.referredUserId || null,
    referralCode: row.referralCode,
    status: row.status,
    qualifiedAt: row.qualifiedAt?.toISOString?.() || null,
    rewardedAt: row.rewardedAt?.toISOString?.() || null,
    metadata: row.metadata || null,
    createdAt: row.createdAt?.toISOString?.() || null
  };
}

export async function ensureReferralCodeInTx(tx, { userId, now = new Date() }) {
  const [existing] = await tx
    .select()
    .from(referrals)
    .where(and(
      eq(referrals.referrerUserId, userId),
      isNull(referrals.referredUserId),
      eq(referrals.status, 'created')
    ))
    .limit(1);
  if (existing) return existing;

  const [created] = await tx.insert(referrals).values({
    referrerUserId: userId,
    referralCode: makeCode('miner'),
    status: 'created',
    metadata: { kind: 'owner_code' },
    createdAt: now,
    updatedAt: now
  }).returning();
  return created;
}

export async function qualifyReferralForUserInTx(tx, { userId, now = new Date() }) {
  const rows = await tx
    .select()
    .from(referrals)
    .where(and(
      eq(referrals.referredUserId, userId),
      eq(referrals.status, 'linked')
    ))
    .for('update');

  for (const row of rows) {
    await tx
      .update(referrals)
      .set({ status: 'qualified', qualifiedAt: now, updatedAt: now })
      .where(eq(referrals.id, row.id));
  }
  return rows.length;
}

export function createReferralsService(db, config) {
  return {
    async getMe({ userId, now = new Date() }) {
      return db.transaction(async (tx) => {
        const code = await ensureReferralCodeInTx(tx, { userId, now });
        const relationships = await tx
          .select()
          .from(referrals)
          .where(and(
            eq(referrals.referrerUserId, userId),
            ne(referrals.status, 'created')
          ));

        const referralLink = `${String(config.publicAppOrigin).replace(/\/+$/, '')}/?ref=${encodeURIComponent(code.referralCode)}`;
        return {
          code: code.referralCode,
          referralLink,
          relationships: relationships.map(serializeReferral)
        };
      });
    },

    async applyCode({ userId, code, now = new Date(), idempotency, request = null }) {
      const normalizedCode = String(code || '').trim();
      if (!normalizedCode) {
        throw new ActionError('invalid_referral_code', 'Referral code is required', { statusCode: 400 });
      }

      return db.transaction(async (tx) => runIdempotentAction(tx, {
        userId,
        route: '/api/referrals/apply-code',
        scope: `referral_apply:${userId}`,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        now,
        run: async () => {
          const [ownerCode] = await tx
            .select()
            .from(referrals)
            .where(and(
              eq(referrals.referralCode, normalizedCode),
              eq(referrals.status, 'created'),
              isNull(referrals.referredUserId)
            ))
            .limit(1);
          if (!ownerCode) {
            throw new ActionError('referral_code_not_found', 'Referral code was not found', { statusCode: 404 });
          }
          if (ownerCode.referrerUserId === userId) {
            throw new ActionError('self_referral_rejected', 'Self-referral is not allowed', { statusCode: 409 });
          }

          const [existing] = await tx
            .select()
            .from(referrals)
            .where(eq(referrals.referredUserId, userId))
            .limit(1);
          if (existing) {
            throw new ActionError('referral_already_applied', 'Referral was already applied', { statusCode: 409 });
          }

          const [relationship] = await tx.insert(referrals).values({
            referrerUserId: ownerCode.referrerUserId,
            referredUserId: userId,
            referralCode: makeCode('rel'),
            status: 'linked',
            metadata: {
              appliedCode: normalizedCode
            },
            createdAt: now,
            updatedAt: now
          }).returning();

          await recordAuditLog(tx, {
            userId,
            eventType: 'referral_linked',
            actorType: 'user',
            request,
            metadata: {
              referrerUserId: ownerCode.referrerUserId,
              referralId: relationship.id
            },
            now
          });

          return { referral: serializeReferral(relationship) };
        }
      }));
    }
  };
}
