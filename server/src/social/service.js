import { and, eq } from 'drizzle-orm';
import { linkedSocials } from '../db/schema.js';
import { ActionError } from '../lib/actionErrors.js';
import { verifyTelegramInitData } from '../telegram/initData.js';
import { recordAuditLog } from '../lib/audit.js';

export const SOCIAL_PROVIDERS = {
  TELEGRAM: 'telegram'
};

function serializeLinkedSocial(row) {
  return {
    id: row.id,
    provider: row.provider,
    providerUserId: row.providerUserId,
    username: row.username || null,
    verifiedAt: row.verifiedAt?.toISOString?.() || null,
    metadata: row.metadata || null
  };
}

export function createSocialService(db, config) {
  return {
    async verifyTelegram({ userId, initData, now = new Date(), request = null }) {
      const verified = verifyTelegramInitData(initData, {
        botToken: config.telegramBotToken,
        ttlSeconds: config.telegramInitDataTtlSeconds,
        now
      });

      if (!verified.ok) {
        await recordAuditLog(db, {
          userId,
          eventType: 'telegram_link_failed',
          actorType: 'user',
          request,
          metadata: { reason: verified.reason },
          now
        });
        throw new ActionError('invalid_telegram_init_data', 'Telegram initData verification failed', {
          statusCode: verified.reason === 'telegram_bot_token_missing' ? 503 : 401,
          details: { reason: verified.reason }
        });
      }

      return db.transaction(async (tx) => {
        const values = {
          userId,
          provider: SOCIAL_PROVIDERS.TELEGRAM,
          providerUserId: verified.user.id,
          username: verified.user.username,
          metadata: {
            firstName: verified.user.firstName,
            lastName: verified.user.lastName,
            languageCode: verified.user.languageCode
          },
          verifiedAt: now,
          updatedAt: now
        };

        const [social] = await tx
          .insert(linkedSocials)
          .values({ ...values, createdAt: now })
          .onConflictDoUpdate({
            target: [linkedSocials.userId, linkedSocials.provider],
            set: values
          })
          .returning();

        await recordAuditLog(tx, {
          userId,
          eventType: 'telegram_linked',
          actorType: 'user',
          request,
          metadata: { providerUserId: verified.user.id },
          now
        });

        return { social: serializeLinkedSocial(social) };
      });
    },

    async getTelegramLink(tx, userId) {
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
  };
}
