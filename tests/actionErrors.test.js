import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiEnvelopeError } from '../src/core/api.js';
import {
  mapServerActionError,
  normalizeServerActionErrorCode,
  safeDebugLogServerActionError
} from '../src/core/actionErrors.js';
import { createTasksController } from '../src/modules/tasks/controller.js';

function createFakeElement(initial = {}) {
  const listeners = new Map();
  const classes = new Set();
  return {
    textContent: '',
    innerHTML: '',
    value: initial.value || '',
    disabled: false,
    dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name)
    },
    addEventListener: (type, handler) => listeners.set(type, handler),
    dispatch: (type, event) => listeners.get(type)?.(event),
    focus: () => {},
    select: () => {},
    ...initial
  };
}

function createTasksElements() {
  return {
    status: createFakeElement(),
    list: createFakeElement(),
    telegramPanel: createFakeElement(),
    telegramLinkBtn: createFakeElement(),
    telegramStatus: createFakeElement(),
    referralCodeInput: createFakeElement(),
    referralCopyBtn: createFakeElement(),
    referralApplyInput: createFakeElement(),
    referralApplyBtn: createFakeElement(),
    referralSummary: createFakeElement()
  };
}

test('server action error mapper normalizes known backend codes into safe UI messages', () => {
  const cases = [
    ['insufficient_balance', 'insufficient_balance'],
    ['nft_requirement_not_met', 'nft_required'],
    ['boost_max_level', 'max_level'],
    ['slot_occupied', 'invalid_slot'],
    ['catalog_item_not_found', 'item_not_found'],
    ['task_already_claimed', 'already_claimed'],
    ['task_condition_not_met', 'task_not_completed'],
    ['invalid_referral_code', 'referral_invalid'],
    ['self_referral_rejected', 'referral_self'],
    ['referral_already_applied', 'referral_already_used'],
    ['payment_receiver_not_configured', 'payment_receiver_not_configured'],
    ['payment_order_expired', 'payment_order_expired'],
    ['missing_auth', 'unauthorized'],
    ['validation_error', 'validation_error']
  ];

  for (const [rawCode, normalizedCode] of cases) {
    const error = new ApiEnvelopeError('raw stack trace: should stay hidden', {
      status: 400,
      code: rawCode,
      meta: { requestId: 'req_safe' }
    });
    const mapped = mapServerActionError(error);
    assert.equal(mapped.normalizedCode, normalizedCode);
    assert.equal(mapped.message.includes('raw stack trace'), false);
  }

  assert.equal(normalizeServerActionErrorCode({ status: 429, code: 'too_many_requests' }), 'rate_limited');
  assert.equal(normalizeServerActionErrorCode({ status: 503, code: 'internal_error' }), 'server_error');
});

test('server action debug logging includes only safe metadata', () => {
  const logs = [];
  safeDebugLogServerActionError(
    new ApiEnvelopeError('secret stack token=abc', {
      status: 500,
      code: 'internal_error',
      details: { token: 'secret' },
      meta: { requestId: 'req_1', serverTime: '2026-04-27T00:00:00.000Z' }
    }),
    {
      action: 'shop_buy',
      isDev: true,
      logger: { warn: (...args) => logs.push(args) }
    }
  );

  assert.equal(logs.length, 1);
  const payload = logs[0][1];
  assert.deepEqual(payload, {
    action: 'shop_buy',
    code: 'internal_error',
    normalizedCode: 'server_error',
    status: 500,
    requestId: 'req_1',
    serverTime: '2026-04-27T00:00:00.000Z'
  });
  assert.equal(JSON.stringify(payload).includes('secret'), false);
});

test('tasks claim UI flow disables duplicate action until server response', async () => {
  const elements = createTasksElements();
  let claimCalls = 0;
  let resolveClaim;
  const appliedStates = [];
  const api = {
    getTasks: async () => ({
      tasks: [{ id: 'connect_telegram', title: 'Connect Telegram', status: 'ready_to_claim', rewardUnits: '1000' }]
    }),
    getReferralsMe: async () => ({ referralCode: 'CODE1', referrals: [] }),
    claimTask: async () => {
      claimCalls += 1;
      return new Promise((resolve) => {
        resolveClaim = () => resolve({ state: { balanceUnits: '2000' } });
      });
    },
    applyReferralCode: async () => ({}),
    verifyTelegramWebApp: async () => ({})
  };

  const controller = createTasksController({
    elements,
    api,
    applyServerState: (state) => appliedStates.push(state),
    showToast: () => {},
    t: (_key, fallback) => fallback,
    createIdempotencyKey: () => 'claim-key',
    getWindow: () => ({})
  });

  await controller.load();
  const firstClaim = controller.claimTask('connect_telegram');
  await controller.claimTask('connect_telegram');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(claimCalls, 1);
  assert.match(elements.list.innerHTML, /disabled/);

  resolveClaim();
  await firstClaim;

  assert.equal(appliedStates.length, 1);
  assert.equal(appliedStates[0].balanceUnits, '2000');
});

test('referral apply UI flow shows mapped error instead of raw server message', async () => {
  const elements = createTasksElements();
  elements.referralApplyInput.value = 'OWNCODE';
  const toasts = [];
  const api = {
    getTasks: async () => ({ tasks: [] }),
    getReferralsMe: async () => ({ referralCode: 'OWNCODE', referrals: [] }),
    claimTask: async () => ({}),
    applyReferralCode: async () => {
      throw new ApiEnvelopeError('raw internal self referral stack', {
        status: 409,
        code: 'self_referral_rejected',
        meta: { requestId: 'req_ref' }
      });
    },
    verifyTelegramWebApp: async () => ({})
  };

  const controller = createTasksController({
    elements,
    api,
    applyServerState: () => {},
    showToast: (message) => toasts.push(message),
    t: (_key, fallback) => fallback,
    createIdempotencyKey: () => 'ref-key',
    getWindow: () => ({})
  });

  await controller.applyReferral();

  assert.equal(elements.status.textContent, 'Self-referral is not allowed.');
  assert.equal(toasts[0], 'Self-referral is not allowed.');
  assert.equal(elements.status.textContent.includes('raw internal'), false);
});
