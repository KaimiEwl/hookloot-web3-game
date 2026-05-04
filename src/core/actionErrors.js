const NORMALIZED_CODES = {
  insufficient_balance: [
    'insufficient_balance',
    'balance_insufficient',
    'not_enough_balance',
    'not_enough_coins',
    'balance_too_low'
  ],
  nft_required: [
    'nft_required',
    'nft_requirement_not_met',
    'inventory_item_missing',
    'inventory_item_required',
    'not_enough_nft',
    'nft_missing',
    'nft_not_owned'
  ],
  max_level: [
    'max_level',
    'boost_max_level',
    'max_level_reached',
    'boost_level_max',
    'boost_already_maxed'
  ],
  invalid_slot: [
    'invalid_slot',
    'slot_invalid',
    'slot_occupied',
    'inventory_slot_occupied',
    'slot_not_found',
    'slot_unavailable'
  ],
  item_not_found: [
    'item_not_found',
    'catalog_item_not_found',
    'invalid_item',
    'rarity_not_found',
    'inventory_item_not_found',
    'unknown_item'
  ],
  already_claimed: [
    'already_claimed',
    'task_already_claimed',
    'already_rewarded',
    'reward_already_claimed'
  ],
  task_not_completed: [
    'task_not_completed',
    'task_condition_not_met',
    'condition_not_met',
    'task_not_ready',
    'not_eligible'
  ],
  referral_invalid: [
    'referral_invalid',
    'invalid_referral_code',
    'referral_code_not_found',
    'referral_not_found'
  ],
  referral_self: [
    'referral_self',
    'self_referral',
    'self_referral_rejected'
  ],
  referral_already_used: [
    'referral_already_used',
    'referral_already_applied',
    'referral_code_used',
    'referral_not_eligible'
  ],
  payment_receiver_not_configured: [
    'payment_receiver_not_configured',
    'receiver_not_configured',
    'treasury_not_configured'
  ],
  payment_order_expired: [
    'payment_order_expired',
    'order_expired',
    'payment_expired'
  ],
  unauthorized: [
    'missing_auth',
    'invalid_auth',
    'unauthorized',
    'forbidden',
    'session_expired'
  ],
  rate_limited: [
    'rate_limited',
    'too_many_requests',
    'http_429'
  ],
  validation_error: [
    'validation_error',
    'bad_request',
    'invalid_request',
    'invalid_body',
    'http_400',
    'http_422'
  ],
  server_error: [
    'server_error',
    'internal_error',
    'api_error',
    'http_500',
    'http_502',
    'http_503',
    'http_504',
    'network_error'
  ]
};

const CODE_LOOKUP = Object.entries(NORMALIZED_CODES).reduce((acc, [normalizedCode, aliases]) => {
  aliases.forEach((alias) => {
    acc[alias] = normalizedCode;
  });
  return acc;
}, {});

const MESSAGE_KEYS = {
  insufficient_balance: ['errors.insufficientBalance', 'Not enough coins.'],
  nft_required: ['errors.nftRequired', 'You need the required NFT first.'],
  max_level: ['errors.maxLevel', 'Maximum level is already reached.'],
  invalid_slot: ['errors.invalidSlot', 'This NFT slot is unavailable.'],
  item_not_found: ['errors.itemNotFound', 'This item is not available.'],
  already_claimed: ['errors.alreadyClaimed', 'Reward is already claimed.'],
  task_not_completed: ['errors.taskNotCompleted', 'Task is not completed yet.'],
  referral_invalid: ['errors.referralInvalid', 'Invalid referral code.'],
  referral_self: ['errors.referralSelf', 'Self-referral is not allowed.'],
  referral_already_used: ['errors.referralAlreadyUsed', 'Referral code is already used.'],
  payment_receiver_not_configured: ['errors.paymentReceiverNotConfigured', 'Payment receiver is not configured yet.'],
  payment_order_expired: ['errors.paymentOrderExpired', 'Payment order expired. Create a new one.'],
  unauthorized: ['errors.unauthorized', 'Connect TON wallet first.'],
  rate_limited: ['errors.rateLimited', 'Too many attempts. Try again later.'],
  validation_error: ['errors.validationError', 'Check the entered data and try again.'],
  server_error: ['errors.serverError', 'Server error. Try again.']
};

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, '_');
}

function getCandidateCodes(error) {
  const candidates = [
    error?.code,
    error?.error?.code,
    error?.details?.code,
    error?.details?.reason
  ];

  if (error?.status) candidates.push(`http_${error.status}`);
  return candidates.map(normalizeCode).filter(Boolean);
}

export function normalizeServerActionErrorCode(error) {
  const candidates = getCandidateCodes(error);
  for (const code of candidates) {
    if (CODE_LOOKUP[code]) return CODE_LOOKUP[code];
  }

  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) return 'validation_error';
  if (status >= 500 || status === 0) return 'server_error';

  return 'server_error';
}

export function mapServerActionError(error, translate = (_key, fallback) => fallback) {
  const normalizedCode = normalizeServerActionErrorCode(error);
  const [messageKey, fallback] = MESSAGE_KEYS[normalizedCode] || MESSAGE_KEYS.server_error;
  return {
    code: normalizeCode(error?.code || error?.error?.code || ''),
    normalizedCode,
    status: Number(error?.status || 0),
    message: translate(messageKey, fallback),
    meta: error?.meta || null,
    retryable: ['rate_limited', 'server_error', 'payment_order_expired'].includes(normalizedCode)
  };
}

function defaultIsDevMode() {
  try {
    return Boolean(import.meta?.env?.DEV);
  } catch {
    return false;
  }
}

export function safeDebugLogServerActionError(error, {
  action = 'server_action',
  logger = console,
  isDev = defaultIsDevMode()
} = {}) {
  if (!isDev || !logger || typeof logger.warn !== 'function') return;

  const mapped = mapServerActionError(error);
  logger.warn('[server-action-error]', {
    action,
    code: mapped.code,
    normalizedCode: mapped.normalizedCode,
    status: mapped.status,
    requestId: error?.meta?.requestId || null,
    serverTime: error?.meta?.serverTime || null
  });
}
