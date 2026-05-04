export const TELEGRAM_MEMBER_STATUSES = new Set([
  'creator',
  'administrator',
  'member'
]);

export async function getTelegramChatMember({
  botToken,
  apiBaseUrl = 'https://api.telegram.org',
  chatId,
  userId,
  fetchImpl = globalThis.fetch
}) {
  if (!botToken) return { ok: false, reason: 'telegram_bot_token_missing' };
  if (!chatId) return { ok: false, reason: 'telegram_channel_not_configured' };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'telegram_fetch_unavailable' };

  const url = new URL(`${String(apiBaseUrl).replace(/\/+$/, '')}/bot${botToken}/getChatMember`);
  url.searchParams.set('chat_id', chatId);
  url.searchParams.set('user_id', String(userId));

  const response = await fetchImpl(url, { method: 'GET' });
  if (!response.ok) {
    if (response.status === 429) {
      return { ok: false, reason: 'telegram_rate_limited', retryable: true, status: response.status };
    }
    if (response.status === 400 || response.status === 403) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const description = String(payload?.description || '').toLowerCase();
      if (description.includes('user not found') || description.includes('user_id_invalid')) {
        return { ok: true, status: 'not_found', isMember: false };
      }
      return {
        ok: false,
        reason: 'verification_unavailable',
        retryable: false,
        status: response.status,
        details: payload?.description || null
      };
    }
    return { ok: false, reason: 'telegram_api_error', retryable: true, status: response.status };
  }

  const payload = await response.json();
  if (!payload?.ok) {
    const description = String(payload?.description || '').toLowerCase();
    if (description.includes('user not found') || description.includes('user_id_invalid')) {
      return { ok: true, status: 'not_found', isMember: false };
    }
    if (
      description.includes('chat not found') ||
      description.includes('not enough rights') ||
      description.includes('bot is not a member') ||
      description.includes('forbidden')
    ) {
      return {
        ok: false,
        reason: 'verification_unavailable',
        retryable: false,
        details: payload?.description || null
      };
    }
    return {
      ok: false,
      reason: 'telegram_api_error',
      retryable: true,
      details: payload?.description || null
    };
  }

  const status = payload.result?.status || '';
  return {
    ok: true,
    status,
    isMember: TELEGRAM_MEMBER_STATUSES.has(status)
  };
}
