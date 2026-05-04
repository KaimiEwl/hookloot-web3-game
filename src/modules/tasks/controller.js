import { formatUnitsForDisplay } from '../../core/serverState.js';
import {
  mapServerActionError,
  normalizeServerActionErrorCode,
  safeDebugLogServerActionError
} from '../../core/actionErrors.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function trimFormattedUnits(text) {
  return String(text || '0')
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '')
    .replace(/\.$/, '');
}

export function formatTaskRewardUnits(value) {
  return trimFormattedUnits(formatUnitsForDisplay(value || 0, 3));
}

export function getTelegramWebAppInitData(win = globalThis.window) {
  const initData = win?.Telegram?.WebApp?.initData;
  return typeof initData === 'string' ? initData : '';
}

export function getTaskId(task) {
  return String(
    task?.id
    || task?.taskId
    || task?.task_id
    || task?.taskCode
    || task?.task_code
    || task?.code
    || task?.task?.id
    || task?.task?.taskCode
    || task?.task?.task_code
    || ''
  );
}

export function getTaskStatus(task) {
  if (task?.isActive === false || task?.active === false) return 'blocked';
  const raw = String(
    task?.status
    || task?.userStatus
    || task?.user_status
    || task?.userTask?.status
    || task?.progress?.status
    || task?.claimStatus
    || task?.conditionStatus
    || task?.readiness?.status
    || task?.state
    || ''
  ).toLowerCase().replace(/[\s-]+/g, '_');

  if (['claimed', 'completed', 'done', 'rewarded'].includes(raw)) return 'claimed';
  if (['blocked', 'inactive', 'rejected', 'failed'].includes(raw)) return 'blocked';

  const rawReadinessReason = String(task?.readiness?.reason || task?.readiness?.code || '')
    .toLowerCase()
    .replace(/[\s.-]+/g, '_');
  const readinessRetryable = task?.readiness?.retryable === true;

  if (task?.readiness?.ok === true) return 'ready_to_claim';
  if (rawReadinessReason === 'not_configured') return 'not_configured';
  if (
    readinessRetryable
    || [
      'telegram_rate_limited',
      'telegram_api_error',
      'telegram_timeout',
      'temporary_error'
    ].includes(rawReadinessReason)
  ) return 'retryable_error';
  if ([
    'verification_unavailable',
    'telegram_verification_unavailable',
    'telegram_bot_access_denied',
    'telegram_bot_access_unavailable',
    'telegram_bot_token_missing',
    'telegram_channel_missing'
  ].includes(rawReadinessReason)) return 'verification_unavailable';
  if (rawReadinessReason === 'telegram_not_linked') return 'needs_telegram';

  if (task?.canClaim === true || task?.claimable === true || task?.readyToClaim === true) return 'ready_to_claim';

  if (['ready', 'ready_to_claim', 'claimable'].includes(raw)) return 'ready_to_claim';
  if (['not_configured'].includes(raw)) return 'not_configured';
  if (['verification_unavailable'].includes(raw)) return 'verification_unavailable';
  if (['retryable_error'].includes(raw)) return 'retryable_error';
  if (['needs_telegram', 'telegram_not_linked'].includes(raw)) return 'needs_telegram';
  if (['needs_action', 'need_action', 'pending', 'not_eligible', 'condition_not_met'].includes(raw)) return 'needs_action';
  return 'not_started';
}

function getTaskType(task) {
  return String(task?.type || task?.taskType || task?.task_type || task?.task?.type || task?.metadata?.type || '').toLowerCase();
}

function getTaskCode(task) {
  return String(task?.taskCode || task?.task_code || task?.code || task?.task?.taskCode || task?.task?.task_code || '').toLowerCase();
}

function isTelegramTask(task) {
  const type = getTaskType(task);
  const code = getTaskCode(task);
  return type.includes('telegram')
    || code.includes('telegram')
    || code.includes('subscribe')
    || code.includes('channel');
}

function getTaskTitle(task) {
  return String(task?.title || task?.name || task?.task?.title || task?.task?.name || task?.taskCode || task?.task_code || task?.code || 'Task');
}

function getTaskDescription(task) {
  return String(task?.description || task?.subtitle || task?.task?.description || task?.task?.subtitle || task?.metadata?.description || '');
}

function getRewardUnits(task) {
  return task?.rewardUnits
    ?? task?.reward_units
    ?? task?.task?.rewardUnits
    ?? task?.task?.reward_units
    ?? task?.reward?.units
    ?? task?.reward
    ?? 0;
}

export function extractTasks(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.userTasks)) return payload.userTasks;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function extractReferralCode(payload) {
  return String(payload?.referralCode || payload?.code || payload?.myCode || payload?.referral?.code || '');
}

export function extractReferralInvites(payload) {
  if (Array.isArray(payload?.referrals)) return payload.referrals;
  if (Array.isArray(payload?.invites)) return payload.invites;
  if (Array.isArray(payload?.relationships)) return payload.relationships;
  if (Array.isArray(payload?.summary?.relationships)) return payload.summary.relationships;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

export function extractTelegramSocial(payload) {
  const candidates = [
    payload?.social,
    ...(Array.isArray(payload?.socials) ? payload.socials : []),
    ...(Array.isArray(payload?.linkedSocials) ? payload.linkedSocials : []),
    ...(Array.isArray(payload?.linked_socials) ? payload.linked_socials : []),
    ...(Array.isArray(payload?.user?.socials) ? payload.user.socials : []),
    ...(Array.isArray(payload?.user?.linkedSocials) ? payload.user.linkedSocials : []),
    ...(Array.isArray(payload?.user?.linked_socials) ? payload.user.linked_socials : [])
  ].filter(Boolean);

  return candidates.find((item) => String(item?.provider || item?.type || '').toLowerCase() === 'telegram') || null;
}

function getTelegramSocialLabel(social, translate) {
  if (!social) return '';
  const username = social.username || social.metadata?.username;
  const id = social.providerUserId || social.provider_user_id || social.telegramUserId || social.telegram_user_id;
  if (username) return `@${String(username).replace(/^@/, '')}`;
  if (id) return `ID ${id}`;
  return translate('tasks.telegramConnectedShort', 'connected');
}

function getReadinessMessage(task, status, translate) {
  const reason = String(task?.readiness?.reason || '').toLowerCase().replace(/[\s.-]+/g, '_');
  if (status === 'needs_telegram') return translate('tasks.reason.telegramFirst', 'Connect Telegram first.');
  if (status === 'not_configured') return translate('tasks.reason.notConfigured', 'Subscription task is not configured yet.');
  if (status === 'verification_unavailable') return translate('tasks.reason.verificationUnavailable', 'Telegram verification is temporarily unavailable.');
  if (status === 'retryable_error') return translate('tasks.reason.retryable', 'Verification failed temporarily. Try again.');
  if (reason === 'telegram_not_subscribed') return translate('tasks.reason.telegramSubscribe', 'Subscribe to the Telegram channel, then claim.');
  if (reason === 'nft_missing') return translate('tasks.reason.nftMissing', 'Own the required NFT first.');
  return '';
}

function getErrorCode(error) {
  return String(error?.code || error?.error?.code || error?.details?.reason || error?.error?.details?.reason || '')
    .toLowerCase()
    .replace(/[\s.-]+/g, '_');
}

export function mapTaskUiError(error, translate = (_key, fallback) => fallback) {
  const code = getErrorCode(error);
  const status = Number(error?.status || error?.error?.status || 0);
  if (
    code === 'network_error'
    || code === 'api_error'
    || code === 'server_error'
    || code === 'http_502'
    || code === 'http_503'
    || code === 'http_504'
    || status === 0
    || status >= 500
  ) {
    return translate('tasks.offline', 'Server is unavailable. Check the connection and retry.');
  }
  if (code === 'telegram_unavailable') {
    return translate('tasks.telegramUnavailable', 'Telegram WebApp is unavailable here.');
  }
  if (code === 'not_configured' || code === 'telegram_bot_token_missing' || code === 'telegram_channel_missing') {
    return translate('tasks.reason.notConfigured', 'Subscription task is not configured yet.');
  }
  if (code === 'verification_unavailable' || code === 'telegram_verification_unavailable') {
    return translate('tasks.reason.verificationUnavailable', 'Telegram verification is temporarily unavailable.');
  }
  return mapServerActionError(error, translate).message;
}

function createDefaultIdempotencyKey(action) {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${action}:${random}`;
}

export function createTasksController({
  elements,
  api,
  applyServerState,
  refreshState,
  showToast,
  t,
  createIdempotencyKey = createDefaultIdempotencyKey,
  getWindow = () => globalThis.window,
  getTelegramOpenUrl = () => '',
  onConnectWallet = null
}) {
  const translate = typeof t === 'function' ? t : (_key, fallback) => fallback;
  const notify = typeof showToast === 'function' ? showToast : () => {};
  let tasksPayload = null;
  let referralsPayload = null;
  let tasksError = null;
  let referralsError = null;
  let currentUserPayload = null;
  let currentUserError = null;
  let telegramSocial = null;
  let loading = false;
  let initialized = false;
  let pendingAction = '';
  let actionStatus = null;

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function setStatus(message, type = '') {
    if (!elements?.status) return;
    elements.status.textContent = message || '';
    elements.status.dataset.type = type;
  }

  function isUnauthorized() {
    return normalizeServerActionErrorCode(tasksError) === 'unauthorized'
      || normalizeServerActionErrorCode(referralsError) === 'unauthorized';
  }

  function renderTelegramPanel() {
    if (!elements?.telegramPanel) return;

    const rawInitData = getTelegramWebAppInitData(getWindow());
    const openUrl = String(typeof getTelegramOpenUrl === 'function' ? getTelegramOpenUrl() : '').trim();
    const connected = Boolean(telegramSocial);
    elements.telegramPanel.classList.toggle('telegram-unavailable', !rawInitData && !connected);
    elements.telegramPanel.classList.toggle('telegram-connected', connected);

    const existingOpenLink = elements.telegramPanel.querySelector?.('.tasks-telegram-open-btn');
    if (existingOpenLink) existingOpenLink.remove();

    if (openUrl && !rawInitData && !connected && elements.telegramLinkBtn?.parentNode) {
      const openLink = elements.telegramPanel.ownerDocument.createElement('a');
      openLink.className = 'tasks-action-btn tasks-action-secondary tasks-telegram-open-btn';
      openLink.href = openUrl;
      openLink.target = '_blank';
      openLink.rel = 'noreferrer';
      openLink.textContent = translate('tasks.telegramOpen', 'Open in Telegram');
      elements.telegramLinkBtn.parentNode.insertBefore(openLink, elements.telegramLinkBtn.nextSibling);
    }

    setText(
      elements.telegramStatus,
      connected
        ? translate('tasks.telegramConnectedStatus', 'Telegram connected: {account}', {
          account: getTelegramSocialLabel(telegramSocial, translate)
        })
        : rawInitData
          ? translate('tasks.telegramReady', 'Telegram WebApp detected. Link it to claim Telegram tasks.')
          : translate('tasks.telegramUnavailable', 'Telegram linking is available when opening the app from Telegram.')
    );
    if (elements.telegramLinkBtn) {
      const isPending = pendingAction === 'telegram-link';
      elements.telegramLinkBtn.disabled = connected || !rawInitData || loading || Boolean(pendingAction);
      elements.telegramLinkBtn.classList.toggle('is-action-loading', isPending);
      elements.telegramLinkBtn.textContent = connected
        ? translate('tasks.telegramConnected', 'Telegram connected')
        : isPending
        ? translate('tasks.telegramLinking', 'Linking Telegram...')
        : translate('tasks.telegramLink', 'Link Telegram');
    }
  }

  function renderTask(task) {
    const id = getTaskId(task);
    const title = getTaskTitle(task);
    const description = getTaskDescription(task);
    const status = getTaskStatus(task);
    const reward = formatTaskRewardUnits(getRewardUnits(task));
    const statusLabel = translate(`tasks.status.${status}`, status.replace(/_/g, ' '));
    const readinessMessage = getReadinessMessage(task, status, translate);
    const canClaim = status === 'ready_to_claim' || status === 'retryable_error';
    const shouldConnectTelegram = status === 'needs_telegram' && isTelegramTask(task);
    const isPending = pendingAction === `task:${id}`;
    let actionText = translate('tasks.claim', 'Claim');
    if (status === 'claimed') actionText = translate('tasks.claimed', 'Claimed');
    else if (shouldConnectTelegram) actionText = translate('tasks.connectTelegramFirst', 'Connect Telegram');
    else if (status === 'retryable_error') actionText = translate('tasks.retry', 'Retry');
    if (isPending) actionText = translate('tasks.claiming', 'Claiming reward...');

    return `
      <article class="task-card task-card-${escapeHtml(status)}" data-task-id="${escapeHtml(id)}">
        <div class="task-card-main">
          <div class="task-title-row">
            <h3>${escapeHtml(title)}</h3>
            <span class="task-status-chip">${escapeHtml(statusLabel)}</span>
          </div>
          ${description ? `<p class="task-description">${escapeHtml(description)}</p>` : ''}
          ${readinessMessage ? `<p class="task-description task-readiness-message">${escapeHtml(readinessMessage)}</p>` : ''}
          <div class="task-reward">
            <span>${escapeHtml(translate('tasks.reward', 'Reward'))}</span>
            <strong>${escapeHtml(reward)} ${escapeHtml(translate('tasks.rewardUnit', 'coins'))}</strong>
          </div>
        </div>
        <button class="task-claim-btn ${isPending ? 'is-action-loading' : ''}" data-task-id="${escapeHtml(id)}" data-task-action="${shouldConnectTelegram ? 'connect-telegram' : 'claim'}" ${(canClaim || shouldConnectTelegram) && !pendingAction ? '' : 'disabled'} aria-busy="${isPending ? 'true' : 'false'}">
          ${escapeHtml(actionText)}
        </button>
      </article>
    `;
  }

  function renderTasks() {
    if (!elements?.list) return;

    if (loading && !tasksPayload) {
      elements.list.innerHTML = `
        <div class="tasks-state-card tasks-loading">${escapeHtml(translate('tasks.loading', 'Loading tasks...'))}</div>
      `;
      return;
    }

    if (isUnauthorized()) {
      elements.list.innerHTML = `
        <div class="tasks-state-card tasks-unauthorized">
          <strong>${escapeHtml(translate('tasks.unauthorizedTitle', 'Wallet required'))}</strong>
          <span>${escapeHtml(translate('tasks.unauthorizedText', 'Connect TON wallet to load tasks and referrals.'))}</span>
          <button class="tasks-action-btn tasks-connect-wallet-btn" type="button">
            ${escapeHtml(translate('wallet.connect', 'Connect TON Wallet'))}
          </button>
        </div>
      `;
      return;
    }

    if (tasksError) {
      elements.list.innerHTML = `
        <div class="tasks-state-card tasks-error">
          <strong>${escapeHtml(translate('tasks.offlineTitle', 'Server unavailable'))}</strong>
          <span>${escapeHtml(mapTaskUiError(tasksError, translate))}</span>
          <button class="tasks-action-btn tasks-retry-btn" type="button">
            ${escapeHtml(translate('tasks.offlineRetry', 'Retry'))}
          </button>
        </div>
      `;
      return;
    }

    const tasks = extractTasks(tasksPayload);
    if (!tasks.length) {
      elements.list.innerHTML = `
        <div class="tasks-state-card tasks-empty">${escapeHtml(translate('tasks.empty', 'No tasks yet. Check back soon.'))}</div>
      `;
      return;
    }

    elements.list.innerHTML = tasks.map(renderTask).join('');
  }

  function renderReferrals() {
    const code = extractReferralCode(referralsPayload);
    const invites = extractReferralInvites(referralsPayload);
    if (elements?.referralCodeInput) {
      elements.referralCodeInput.value = code || translate('tasks.refNoCode', 'No code yet');
    }
    if (elements?.referralCopyBtn) {
      elements.referralCopyBtn.disabled = !code;
    }
    if (elements?.referralApplyBtn) {
      const isPending = pendingAction === 'referral-apply';
      elements.referralApplyBtn.disabled = loading || Boolean(pendingAction);
      elements.referralApplyBtn.classList.toggle('is-action-loading', isPending);
      elements.referralApplyBtn.textContent = isPending
        ? translate('tasks.refApplying', 'Applying referral code...')
        : translate('tasks.refApply', 'Apply');
    }
    if (elements?.referralSummary) {
      if (referralsError && !isUnauthorized()) {
        elements.referralSummary.innerHTML = `
          <div class="tasks-state-card tasks-error">${escapeHtml(mapTaskUiError(referralsError, translate))}</div>
        `;
      } else if (invites.length) {
        elements.referralSummary.innerHTML = `
          <div class="referral-summary-line">
            <span>${escapeHtml(translate('tasks.refInvites', 'Invites'))}</span>
            <strong>${escapeHtml(String(invites.length))}</strong>
          </div>
          <div class="referral-invite-list">
            ${invites.slice(0, 5).map((invite) => `
              <div class="referral-invite-item">
                <span>${escapeHtml(invite?.username || invite?.walletAddress || invite?.referredUserId || invite?.id || translate('tasks.refFriend', 'Friend'))}</span>
                <strong>${escapeHtml(invite?.status || '')}</strong>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        elements.referralSummary.innerHTML = `
          <div class="referral-summary-line">
            <span>${escapeHtml(translate('tasks.refInvites', 'Invites'))}</span>
            <strong>0</strong>
          </div>
        `;
      }
    }
  }

  function render() {
    renderTelegramPanel();
    renderTasks();
    renderReferrals();

    if (actionStatus?.message) {
      setStatus(actionStatus.message, actionStatus.type || '');
    } else if (loading) {
      setStatus(translate('tasks.loading', 'Loading tasks...'), 'loading');
    } else if (isUnauthorized()) {
      setStatus(translate('tasks.unauthorizedText', 'Connect TON wallet to load tasks and referrals.'), 'unauthorized');
    } else if (tasksError || referralsError) {
      setStatus(mapTaskUiError(tasksError || referralsError, translate), 'error');
    } else {
      setStatus('', '');
    }
  }

  async function load({ silent = false } = {}) {
    loading = true;
    tasksError = null;
    referralsError = null;
    currentUserError = null;
    if (!silent) render();

    const requests = [
      api.getTasks(),
      typeof api.getReferrals === 'function' ? api.getReferrals() : api.getReferralsMe()
    ];
    if (typeof api.getCurrentUser === 'function') requests.push(api.getCurrentUser());

    const [tasksResult, referralsResult, userResult] = await Promise.allSettled(requests);

    if (tasksResult.status === 'fulfilled') tasksPayload = tasksResult.value;
    else tasksError = tasksResult.reason;

    if (referralsResult.status === 'fulfilled') referralsPayload = referralsResult.value;
    else referralsError = referralsResult.reason;

    if (userResult) {
      if (userResult.status === 'fulfilled') {
        currentUserPayload = userResult.value;
        telegramSocial = extractTelegramSocial(currentUserPayload);
      } else {
        currentUserError = userResult.reason;
        telegramSocial = null;
      }
    }

    loading = false;
    render();
  }

  async function refreshAuthoritativeStateFromAction(result) {
    const serverState = result?.state || result?.gameState || result?.authoritativeState;
    if (serverState && typeof applyServerState === 'function') {
      applyServerState(serverState);
      return;
    }
    if (typeof refreshState === 'function') {
      await refreshState({ persist: false, silent: true });
    }
  }

  async function claimTask(taskId) {
    if (!taskId || pendingAction) return;
    pendingAction = `task:${taskId}`;
    actionStatus = { message: translate('tasks.claiming', 'Claiming reward...'), type: 'loading' };
    render();
    try {
      const result = await api.claimTask({
        taskId,
        idempotencyKey: createIdempotencyKey(`task-claim-${taskId}`)
      });
      await refreshAuthoritativeStateFromAction(result);
      notify(translate('tasks.claimSuccess', 'Task reward claimed'));
      actionStatus = null;
      await load({ silent: true });
    } catch (error) {
      safeDebugLogServerActionError(error, { action: 'tasks_claim' });
      const message = mapTaskUiError(error, translate);
      actionStatus = { message, type: 'error' };
      notify(message);
      render();
    } finally {
      pendingAction = '';
      render();
    }
  }

  async function linkTelegram() {
    if (pendingAction) return;
    const initData = getTelegramWebAppInitData(getWindow());
    if (!initData) {
      const message = translate('tasks.telegramUnavailable', 'Open inside Telegram WebApp to link Telegram tasks.');
      actionStatus = { message, type: 'error' };
      render();
      notify(message);
      return;
    }

    pendingAction = 'telegram-link';
    actionStatus = { message: translate('tasks.telegramLinking', 'Linking Telegram...'), type: 'loading' };
    render();
    try {
      const result = typeof api.verifyTelegram === 'function'
        ? await api.verifyTelegram({ initData })
        : await api.verifyTelegramWebApp({ initData });
      telegramSocial = extractTelegramSocial(result) || telegramSocial;
      notify(translate('tasks.telegramLinked', 'Telegram linked'));
      actionStatus = null;
      await load({ silent: true });
    } catch (error) {
      safeDebugLogServerActionError(error, { action: 'telegram_verify' });
      const message = mapTaskUiError(error, translate);
      actionStatus = { message, type: 'error' };
      notify(message);
      render();
    } finally {
      pendingAction = '';
      render();
    }
  }

  async function applyReferral() {
    if (pendingAction) return;
    const code = String(elements?.referralApplyInput?.value || '').trim();
    if (!code) {
      actionStatus = { message: translate('tasks.refEnterCode', 'Enter referral code.'), type: 'error' };
      render();
      return;
    }

    pendingAction = 'referral-apply';
    actionStatus = { message: translate('tasks.refApplying', 'Applying referral code...'), type: 'loading' };
    render();
    try {
      const result = await api.applyReferralCode({
        code,
        idempotencyKey: createIdempotencyKey('referral-apply')
      });
      await refreshAuthoritativeStateFromAction(result);
      if (elements?.referralApplyInput) elements.referralApplyInput.value = '';
      notify(translate('tasks.refApplied', 'Referral code applied'));
      actionStatus = null;
      await load({ silent: true });
    } catch (error) {
      safeDebugLogServerActionError(error, { action: 'referrals_apply_code' });
      const message = mapTaskUiError(error, translate);
      actionStatus = { message, type: 'error' };
      notify(message);
      render();
    } finally {
      pendingAction = '';
      render();
    }
  }

  async function copyReferralCode() {
    const code = extractReferralCode(referralsPayload);
    if (!code) return;
    try {
      await getWindow()?.navigator?.clipboard?.writeText?.(code);
      notify(translate('tasks.refCopied', 'Referral code copied'));
    } catch {
      if (elements?.referralCodeInput) {
        elements.referralCodeInput.focus();
        elements.referralCodeInput.select();
        getWindow()?.document?.execCommand?.('copy');
        notify(translate('tasks.refCopied', 'Referral code copied'));
      }
    }
  }

  function bindEvents() {
    if (initialized) return;
    initialized = true;

    elements?.list?.addEventListener('click', (event) => {
      const retryButton = event.target.closest('.tasks-retry-btn');
      if (retryButton) {
        event.preventDefault();
        load({ silent: false }).catch(() => {});
        return;
      }

      const button = event.target.closest('.task-claim-btn');
      if (!button || button.disabled) return;
      if (button.dataset.taskAction === 'connect-telegram') {
        elements?.telegramPanel?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        elements?.telegramLinkBtn?.focus?.();
        actionStatus = {
          message: translate('tasks.connectTelegramFirst', 'Connect Telegram first.'),
          type: 'error'
        };
        render();
        return;
      }
      claimTask(button.dataset.taskId);
    });

    elements?.list?.addEventListener('click', (event) => {
      const button = event.target.closest('.tasks-connect-wallet-btn');
      if (!button) return;
      event.preventDefault();
      if (typeof onConnectWallet === 'function') onConnectWallet();
    });

    elements?.telegramLinkBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      linkTelegram();
    });

    elements?.referralApplyBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      applyReferral();
    });

    elements?.referralApplyInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      applyReferral();
    });

    elements?.referralCopyBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      copyReferralCode();
    });
  }

  bindEvents();

  return {
    load,
    render,
    claimTask,
    linkTelegram,
    applyReferral,
    copyReferralCode
  };
}
