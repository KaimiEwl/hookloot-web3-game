import { timingSafeEqual } from 'node:crypto';
import { authenticateRequest, getBearerToken } from '../auth/requireAuth.js';

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function normalizeWallet(address) {
  return String(address || '').trim().toLowerCase();
}

export async function authenticateAdminRequest(request, config, authService = null) {
  if (config.adminPanelEnabled !== true) {
    return { ok: false, statusCode: 404, code: 'admin_disabled', message: 'Admin panel is disabled' };
  }

  const tokenConfigured = Boolean(config.adminBearerToken);
  const walletSet = new Set((config.adminWalletAddresses || []).map(normalizeWallet).filter(Boolean));

  if (!tokenConfigured && walletSet.size === 0) {
    return { ok: false, statusCode: 403, code: 'admin_not_configured', message: 'Admin access is not configured' };
  }

  const bearer = getBearerToken(request);
  if (tokenConfigured && safeEqual(bearer, config.adminBearerToken)) {
    return {
      ok: true,
      method: 'bearer',
      userId: null,
      sessionId: null,
      walletAddress: null
    };
  }

  const session = authService
    ? await authService.authenticate(request)
    : await authenticateRequest(request, config);
  if (session.ok && walletSet.has(normalizeWallet(session.walletAddress))) {
    return {
      ok: true,
      method: 'wallet',
      userId: session.userId,
      sessionId: session.sessionId,
      walletAddress: session.walletAddress
    };
  }

  return { ok: false, statusCode: 401, code: 'admin_unauthorized', message: 'Admin authorization is required' };
}
