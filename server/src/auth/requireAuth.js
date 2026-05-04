import { verifySessionToken } from './jwt.js';
import { validateActiveSession } from './repository.js';

export function getBearerToken(request) {
  const header = request.headers.authorization;
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function authenticateRequest(request, config, db = null) {
  const token = getBearerToken(request);
  if (!token) {
    return { ok: false, code: 'missing_auth', message: 'Authorization bearer token is required' };
  }

  try {
    const payload = await verifySessionToken(token, config);
    if (!payload.sub || !payload.jti) {
      return { ok: false, code: 'invalid_auth', message: 'Invalid session token' };
    }

    if (db) {
      const active = await validateActiveSession(db, { token, payload, now: new Date() });
      if (!active.ok) {
        return { ok: false, code: 'invalid_auth', message: 'Invalid or expired session token' };
      }
      return {
        ok: true,
        userId: payload.sub,
        sessionId: payload.jti,
        walletAddress: active.wallet?.address || payload.wallet || null,
        sessionExpiresAt: active.session?.expiresAt || null
      };
    }

    return {
      ok: true,
      userId: payload.sub,
      sessionId: payload.jti,
      walletAddress: payload.wallet || null,
      sessionExpiresAt: payload.exp ? new Date(Number(payload.exp) * 1000) : null
    };
  } catch {
    return { ok: false, code: 'invalid_auth', message: 'Invalid or expired session token' };
  }
}
