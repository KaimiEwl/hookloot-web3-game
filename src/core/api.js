const DEFAULT_API_BASE_URL = '/api';
const SESSION_STORAGE_KEY = 'nftMinerApiSession';
const SAFE_RETRY_DELAY_MS = 250;
const NFT_ITEM_ID = 'nft_card';

let runtimeAuthToken = '';
let runtimeAuthExpiresAt = '';

export class ApiEnvelopeError extends Error {
  constructor(message, { status = 0, code = 'api_error', details = null, meta = null } = {}) {
    super(message);
    this.name = 'ApiEnvelopeError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.meta = meta;
  }
}

function getEnvApiBaseUrl() {
  return typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_API_BASE_URL
    : '';
}

export function resolveApiBaseUrl(baseUrl = getEnvApiBaseUrl()) {
  return String(baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '') || DEFAULT_API_BASE_URL;
}

function safeSessionStorage() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadApiAuthSession() {
  if (runtimeAuthToken) {
    return { token: runtimeAuthToken, expiresAt: runtimeAuthExpiresAt };
  }

  const storage = safeSessionStorage();
  if (!storage) return { token: '', expiresAt: '' };

  try {
    const parsed = JSON.parse(storage.getItem(SESSION_STORAGE_KEY) || '{}');
    const token = String(parsed?.token || '');
    const expiresAt = String(parsed?.expiresAt || '');
    if (!token) return { token: '', expiresAt: '' };
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      storage.removeItem(SESSION_STORAGE_KEY);
      return { token: '', expiresAt: '' };
    }
    runtimeAuthToken = token;
    runtimeAuthExpiresAt = expiresAt;
    return { token, expiresAt };
  } catch {
    return { token: '', expiresAt: '' };
  }
}

export function getApiAuthToken() {
  return loadApiAuthSession().token;
}

export function setApiAuthSession({ token, expiresAt = '' } = {}) {
  runtimeAuthToken = String(token || '');
  runtimeAuthExpiresAt = String(expiresAt || '');

  const storage = safeSessionStorage();
  if (!storage) return;

  if (!runtimeAuthToken) {
    storage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    token: runtimeAuthToken,
    expiresAt: runtimeAuthExpiresAt
  }));
}

export function clearApiAuthSession() {
  setApiAuthSession({ token: '', expiresAt: '' });
}

function buildUrl(baseUrl, path) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${path || ''}`;
  return `${resolveApiBaseUrl(baseUrl)}${normalizedPath}`;
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFetchError(error) {
  if (error instanceof ApiEnvelopeError) return error;
  return new ApiEnvelopeError(error?.message || 'Network request failed', {
    status: 0,
    code: 'network_error'
  });
}

export function createApiClient({
  baseUrl,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  getAuthToken = getApiAuthToken
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is required');
  }

  async function request(path, {
    method = 'GET',
    body,
    headers = {},
    idempotencyKey,
    retry = method.toUpperCase() === 'GET' ? 1 : 0
  } = {}) {
    const upperMethod = method.toUpperCase();
    const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
    const requestHeaders = {
      Accept: 'application/json',
      ...headers
    };

    const init = {
      method: upperMethod,
      credentials: 'include',
      headers: requestHeaders
    };

    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    if (idempotencyKey) requestHeaders['Idempotency-Key'] = idempotencyKey;
    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let lastError = null;
    const attempts = Math.max(0, retry) + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetchImpl(buildUrl(baseUrl, path), init);
        const text = await response.text();
        const envelope = text ? JSON.parse(text) : null;

        if (!response.ok || !envelope?.ok) {
          const error = envelope?.error || {};
          throw new ApiEnvelopeError(error.message || response.statusText || 'API request failed', {
            status: response.status,
            code: error.code || `http_${response.status}`,
            details: error.details || null,
            meta: envelope?.meta || null
          });
        }

        return envelope;
      } catch (error) {
        lastError = normalizeFetchError(error);
        if (lastError.status === 401) {
          clearApiAuthSession();
        }
        if (lastError.status >= 400 && lastError.status < 500) break;
        if (upperMethod !== 'GET' || attempt >= attempts - 1) break;
        await sleep(SAFE_RETRY_DELAY_MS);
      }
    }

    throw lastError;
  }

  return {
    request,
    async getGameState() {
      return request('/game/state').then((envelope) => envelope.data);
    },
    async syncGameState({ idempotencyKey } = {}) {
      return request('/game/sync', {
        method: 'POST',
        body: {},
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async syncGame(options) {
      return this.syncGameState(options);
    },
    async requestTonProofPayload() {
      return request('/auth/ton/payload', {
        method: 'POST',
        body: {},
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async verifyTonProof(payload) {
      const data = await request('/auth/ton/verify', {
        method: 'POST',
        body: payload,
        retry: 0
      }).then((envelope) => envelope.data);
      if (data?.token) setApiAuthSession({ token: data.token, expiresAt: data.expiresAt });
      return data;
    },
    async getCurrentUser() {
      return request('/auth/me', {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async logoutAuthSession() {
      try {
        return await request('/auth/logout', {
          method: 'POST',
          body: {},
          retry: 0
        }).then((envelope) => envelope.data);
      } finally {
        clearApiAuthSession();
      }
    },
    async buyShopItem({ itemId = NFT_ITEM_ID, rarityId, idempotencyKey } = {}) {
      return request('/shop/buy', {
        method: 'POST',
        body: { itemId, rarityId },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async activateInventorySlot({ itemId = NFT_ITEM_ID, rarityId, slotIndex, idempotencyKey } = {}) {
      return request('/inventory/activate-slot', {
        method: 'POST',
        body: { itemId, rarityId, slotIndex },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async removeInventorySlot({ slotIndex, idempotencyKey } = {}) {
      return request('/inventory/remove-slot', {
        method: 'POST',
        body: { slotIndex },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async activateCoinBoost({ idempotencyKey } = {}) {
      return request('/boosts/coin/activate', {
        method: 'POST',
        body: {},
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async activateNftBoost({ rarityId, idempotencyKey } = {}) {
      return request('/boosts/nft/activate', {
        method: 'POST',
        body: { rarityId },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async createPaymentOrder({ itemId, idempotencyKey } = {}) {
      return request('/payments/orders', {
        method: 'POST',
        body: { itemId },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async getPaymentOrder(orderId) {
      return request(`/payments/orders/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getPaymentsStatus() {
      return request('/payments/status', {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async createWithdrawalRequest({ amountUnits, assetType = 'TON', destinationWallet, idempotencyKey } = {}) {
      return request('/withdrawals', {
        method: 'POST',
        body: { amountUnits, assetType, destinationWallet },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async getTasks() {
      return request('/tasks', {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async claimTask({ taskId, idempotencyKey } = {}) {
      return request('/tasks/claim', {
        method: 'POST',
        body: { taskId },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async getReferralsMe() {
      return request('/referrals/me', {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getReferrals() {
      return this.getReferralsMe();
    },
    async applyReferralCode({ code, idempotencyKey } = {}) {
      return request('/referrals/apply-code', {
        method: 'POST',
        body: { code },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async verifyTelegramWebApp({ initData } = {}) {
      return request('/auth/telegram/verify', {
        method: 'POST',
        body: { initData },
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async verifyTelegram({ initData } = {}) {
      return this.verifyTelegramWebApp({ initData });
    },
    async getAdminUsers(params = {}) {
      return request(`/admin/users${buildQuery(params)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getAdminUser(userId) {
      return request(`/admin/users/${encodeURIComponent(userId)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getAdminUserLedger(userId, params = {}) {
      return request(`/admin/users/${encodeURIComponent(userId)}/ledger${buildQuery(params)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getAdminUserTasks(userId, params = {}) {
      return request(`/admin/users/${encodeURIComponent(userId)}/tasks${buildQuery(params)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getAdminUserReferrals(userId, params = {}) {
      return request(`/admin/users/${encodeURIComponent(userId)}/referrals${buildQuery(params)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getAdminPaymentOrders(params = {}) {
      return request(`/admin/payments/orders${buildQuery(params)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getAdminPayment(orderId) {
      return request(`/admin/payments/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getAdminWithdrawals(params = {}) {
      return request(`/admin/withdrawals${buildQuery(params)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async getAdminWithdrawal(id) {
      return request(`/admin/withdrawals/${encodeURIComponent(id)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    },
    async markAdminWithdrawalUnderReview({ id, note = '', idempotencyKey } = {}) {
      return request(`/admin/withdrawals/${encodeURIComponent(id)}/mark-under-review`, {
        method: 'POST',
        body: { note },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async rejectAdminWithdrawal({ id, reason, idempotencyKey } = {}) {
      return request(`/admin/withdrawals/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: { reason },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async markAdminWithdrawalPaidExternal({ id, note, externalReference = '', idempotencyKey } = {}) {
      return request(`/admin/withdrawals/${encodeURIComponent(id)}/mark-paid-external`, {
        method: 'POST',
        body: { note, externalReference },
        idempotencyKey,
        retry: 0
      }).then((envelope) => envelope.data);
    },
    async getAdminAuditLogs(params = {}) {
      return request(`/admin/audit-logs${buildQuery(params)}`, {
        method: 'GET',
        retry: 1
      }).then((envelope) => envelope.data);
    }
  };
}

export const apiClient = createApiClient();

export const getGameState = (...args) => apiClient.getGameState(...args);
export const syncGameState = (...args) => apiClient.syncGameState(...args);
export const syncGame = (...args) => apiClient.syncGame(...args);
export const requestTonProofPayload = (...args) => apiClient.requestTonProofPayload(...args);
export const verifyTonProof = (...args) => apiClient.verifyTonProof(...args);
export const getCurrentUser = (...args) => apiClient.getCurrentUser(...args);
export const logoutAuthSession = (...args) => apiClient.logoutAuthSession(...args);
export const buyShopItem = (...args) => apiClient.buyShopItem(...args);
export const activateInventorySlot = (...args) => apiClient.activateInventorySlot(...args);
export const removeInventorySlot = (...args) => apiClient.removeInventorySlot(...args);
export const activateCoinBoost = (...args) => apiClient.activateCoinBoost(...args);
export const activateNftBoost = (...args) => apiClient.activateNftBoost(...args);
export const createPaymentOrder = (...args) => apiClient.createPaymentOrder(...args);
export const getPaymentOrder = (...args) => apiClient.getPaymentOrder(...args);
export const getPaymentsStatus = (...args) => apiClient.getPaymentsStatus(...args);
export const createWithdrawalRequest = (...args) => apiClient.createWithdrawalRequest(...args);
export const getTasks = (...args) => apiClient.getTasks(...args);
export const claimTask = (...args) => apiClient.claimTask(...args);
export const getReferralsMe = (...args) => apiClient.getReferralsMe(...args);
export const getReferrals = (...args) => apiClient.getReferrals(...args);
export const applyReferralCode = (...args) => apiClient.applyReferralCode(...args);
export const verifyTelegramWebApp = (...args) => apiClient.verifyTelegramWebApp(...args);
export const verifyTelegram = (...args) => apiClient.verifyTelegram(...args);
export const getAdminUsers = (...args) => apiClient.getAdminUsers(...args);
export const getAdminUser = (...args) => apiClient.getAdminUser(...args);
export const getAdminUserLedger = (...args) => apiClient.getAdminUserLedger(...args);
export const getAdminUserTasks = (...args) => apiClient.getAdminUserTasks(...args);
export const getAdminUserReferrals = (...args) => apiClient.getAdminUserReferrals(...args);
export const getAdminPaymentOrders = (...args) => apiClient.getAdminPaymentOrders(...args);
export const getAdminPayment = (...args) => apiClient.getAdminPayment(...args);
export const getAdminWithdrawals = (...args) => apiClient.getAdminWithdrawals(...args);
export const getAdminWithdrawal = (...args) => apiClient.getAdminWithdrawal(...args);
export const markAdminWithdrawalUnderReview = (...args) => apiClient.markAdminWithdrawalUnderReview(...args);
export const rejectAdminWithdrawal = (...args) => apiClient.rejectAdminWithdrawal(...args);
export const markAdminWithdrawalPaidExternal = (...args) => apiClient.markAdminWithdrawalPaidExternal(...args);
export const getAdminAuditLogs = (...args) => apiClient.getAdminAuditLogs(...args);
