import { getTelegramChatMember } from './client.js';

function missingTelegramConfig({ botToken, chatId }) {
  return [
    !botToken ? 'TELEGRAM_BOT_TOKEN' : null,
    !chatId ? 'TELEGRAM_REQUIRED_CHANNEL_ID' : null
  ].filter(Boolean);
}

export function createTelegramMembershipProvider({
  botToken,
  apiBaseUrl = 'https://api.telegram.org',
  chatId,
  fetchImpl = globalThis.fetch
} = {}) {
  const missing = missingTelegramConfig({ botToken, chatId });

  return {
    configured: missing.length === 0,
    missing,

    async checkMembership(userId) {
      if (missing.length) {
        return {
          ok: false,
          reason: 'not_configured',
          retryable: false,
          configured: false,
          details: { missing }
        };
      }

      const result = await getTelegramChatMember({
        botToken,
        apiBaseUrl,
        chatId,
        userId,
        fetchImpl
      });

      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason === 'verification_unavailable'
            ? 'verification_unavailable'
            : result.reason,
          retryable: Boolean(result.retryable),
          configured: true,
          status: result.status || null,
          details: result.details || null
        };
      }

      return {
        ok: true,
        configured: true,
        status: result.status,
        isMember: Boolean(result.isMember)
      };
    }
  };
}
