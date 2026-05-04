import { createHmac, timingSafeEqual } from 'node:crypto';

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function parseUser(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function parseTelegramInitData(rawInitData) {
  const params = new URLSearchParams(String(rawInitData || ''));
  const entries = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash' || key === 'signature') continue;
    entries.push([key, value]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return {
    hash: params.get('hash') || '',
    authDate: Number(params.get('auth_date') || 0),
    user: parseUser(params.get('user')),
    dataCheckString: entries.map(([key, value]) => `${key}=${value}`).join('\n')
  };
}

export function verifyTelegramInitData(rawInitData, {
  botToken,
  ttlSeconds = 86400,
  now = new Date()
} = {}) {
  if (!botToken) return { ok: false, reason: 'telegram_bot_token_missing' };
  const parsed = parseTelegramInitData(rawInitData);
  if (!parsed.hash || !parsed.dataCheckString || !parsed.authDate) {
    return { ok: false, reason: 'invalid_init_data' };
  }

  const ageSeconds = Math.floor(now.getTime() / 1000) - parsed.authDate;
  if (ageSeconds < -60 || ageSeconds > Number(ttlSeconds || 0)) {
    return { ok: false, reason: 'init_data_expired' };
  }

  const secretKey = hmac('WebAppData', botToken);
  const expected = createHmac('sha256', secretKey)
    .update(parsed.dataCheckString)
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(parsed.hash, 'hex');

  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, reason: 'invalid_init_data_signature' };
  }

  if (!parsed.user?.id) {
    return { ok: false, reason: 'telegram_user_missing' };
  }

  return {
    ok: true,
    user: {
      id: String(parsed.user.id),
      username: parsed.user.username ? String(parsed.user.username) : null,
      firstName: parsed.user.first_name ? String(parsed.user.first_name) : null,
      lastName: parsed.user.last_name ? String(parsed.user.last_name) : null,
      languageCode: parsed.user.language_code ? String(parsed.user.language_code) : null
    },
    authDate: new Date(parsed.authDate * 1000)
  };
}
