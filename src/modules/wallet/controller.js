import {
  buildTonBalanceEndpoints,
  buildTonNftEndpoints,
  formatTonValue,
  formatWalletAddress,
  formatWalletLabel,
  normalizeWalletNfts,
  tonToNanoString
} from './index.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createWalletController({
  state,
  rarities,
  storageKeys,
  appEvents,
  tonBalanceRefreshMs,
  tonManifestUrl,
  TonConnectUIClass,
  readString,
  writeString,
  emitWindowEvent,
  showToast,
  getReferralLink,
  saveState,
  renderInventory,
  renderBoostTasks,
  updateStats,
  prepareTonProofPayload,
  verifyTonProofPayload,
  createPaymentOrder,
  getPaymentOrderStatus,
  getPaymentsStatus,
  refreshServerState,
  createActionIdempotencyKey,
  onAuthReady,
  onAuthError,
  dom
}) {
  function t(key, fallback, vars = {}) {
    const translate = window.appTranslate;
    if (typeof translate === 'function') {
      return translate(key, fallback, vars);
    }
    let text = fallback || key;
    Object.entries(vars).forEach(([name, value]) => {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    });
    return text;
  }

  let tonConnectUI = null;
  let tonWalletAddress = '';
  let tonBalanceNano = 0;
  let tonBalanceUpdatedAt = 0;
  let tonBalanceRefreshTimer = null;
  let shopTonReceiverAddress = '';
  let walletNfts = [];
  let walletNftsLoading = false;
  let walletNftsError = '';
  let tonProofPreparing = false;
  let paymentsStatus = {
    loading: false,
    data: null,
    error: ''
  };

  function buildIdempotencyKey(prefix) {
    if (typeof createActionIdempotencyKey === 'function') return createActionIdempotencyKey(prefix);
    const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}:${suffix}`;
  }

  function getTonWalletAddress() {
    return tonWalletAddress;
  }

  function getShopTonReceiverAddress() {
    return shopTonReceiverAddress;
  }

  function getTonBalanceTon() {
    return tonBalanceNano / 1e9;
  }

  function getWalletNfts() {
    return walletNfts.slice();
  }

  function setTonBalanceNano(nextNano, ts = Date.now()) {
    tonBalanceNano = Math.max(0, Number(nextNano || 0));
    tonBalanceUpdatedAt = ts;
    updateWalletUI();
    emitWindowEvent(appEvents.TON_BALANCE_CHANGED, {
      nano: tonBalanceNano,
      ton: tonBalanceNano / 1e9,
      updatedAt: tonBalanceUpdatedAt
    });
  }

  function setTonWallet(address) {
    tonWalletAddress = address || '';
    updateWalletUI();
    emitWindowEvent(appEvents.TON_WALLET_CHANGED, { address: tonWalletAddress });
  }

  async function refreshTonProofPayload() {
    if (!tonConnectUI || typeof tonConnectUI.setConnectRequestParameters !== 'function') return;
    if (typeof prepareTonProofPayload !== 'function') return;
    if (tonProofPreparing) return;

    tonProofPreparing = true;
    try {
      tonConnectUI.setConnectRequestParameters({ state: 'loading' });
      const payload = await prepareTonProofPayload();
      if (payload?.payload) {
        tonConnectUI.setConnectRequestParameters({
          state: 'ready',
          value: { tonProof: payload.payload }
        });
      } else {
        tonConnectUI.setConnectRequestParameters(null);
      }
    } catch (err) {
      console.error('TON proof payload request failed', err);
      tonConnectUI.setConnectRequestParameters(null);
    } finally {
      tonProofPreparing = false;
    }
  }

  async function verifyWalletTonProof(wallet) {
    if (typeof verifyTonProofPayload !== 'function') return null;
    const proofItem = wallet?.connectItems?.tonProof;
    if (!proofItem || proofItem.name !== 'ton_proof' || !proofItem.proof) return null;

    try {
      const account = wallet?.account || {};
      const result = await verifyTonProofPayload({
        address: account.address,
        network: account.chain,
        public_key: account.publicKey,
        publicKey: account.publicKey,
        proof: {
          ...proofItem.proof,
          state_init: account.walletStateInit,
          stateInit: account.walletStateInit
        }
      });
      if (typeof onAuthReady === 'function') onAuthReady(result);
      return result;
    } catch (err) {
      console.error('TON proof verify failed', err);
      if (typeof onAuthError === 'function') onAuthError(err);
      return null;
    }
  }

  function setShopTonReceiverAddress(address) {
    shopTonReceiverAddress = (address || '').trim();
    updateWalletUI();
  }

  function setWalletNfts(nextItems, { loading = false, error = '' } = {}) {
    walletNfts = Array.isArray(nextItems) ? nextItems : [];
    walletNftsLoading = !!loading;
    walletNftsError = error || '';
    renderWalletNfts();
  }

  function buildWalletSummaryMarkup() {
    const recognized = rarities
      .map((rarity) => {
        const count = walletNfts.filter((item) => item.rarityId === rarity.id).length;
        return count > 0 ? { rarity, count } : null;
      })
      .filter(Boolean);

    if (!recognized.length) return '';

    return recognized
      .map(({ rarity, count }) => (
        `<span class="wallet-nft-chip" data-rarity="${escapeHtml(rarity.id)}">${escapeHtml(rarity.name)} x${count}</span>`
      ))
      .join('');
  }

  function renderWalletNfts() {
    const {
      walletNftState,
      walletNftGrid,
      walletNftCount,
      walletNftSummary,
      walletRefreshNftsBtn
    } = dom;

    if (walletNftCount) {
      const label = t('wallet.nftCount', '{count} NFT', { count: walletNfts.length });
      walletNftCount.textContent = label;
    }

    if (walletRefreshNftsBtn) {
      walletRefreshNftsBtn.disabled = !tonWalletAddress || walletNftsLoading;
      walletRefreshNftsBtn.textContent = walletNftsLoading
        ? t('wallet.loadingShort', 'Loading...')
        : t('wallet.refresh', 'Refresh');
    }

    if (walletNftSummary) {
      const summaryMarkup = buildWalletSummaryMarkup();
      walletNftSummary.innerHTML = summaryMarkup;
      walletNftSummary.classList.toggle('is-visible', !!summaryMarkup);
    }

    if (!walletNftGrid || !walletNftState) return;
    walletNftGrid.innerHTML = '';

    if (!tonWalletAddress) {
      walletNftState.textContent = t('wallet.nftEmpty', 'Connect wallet to see NFTs.');
      walletNftState.classList.remove('hidden');
      return;
    }

    if (walletNftsLoading) {
      walletNftState.textContent = t('wallet.nftLoading', 'Loading wallet NFTs...');
      walletNftState.classList.remove('hidden');
      return;
    }

    if (walletNftsError) {
      walletNftState.textContent = walletNftsError;
      walletNftState.classList.remove('hidden');
      return;
    }

    if (!walletNfts.length) {
      walletNftState.textContent = t('wallet.nftEmptyConnected', 'No NFTs found on this wallet yet.');
      walletNftState.classList.remove('hidden');
      return;
    }

    walletNftState.classList.add('hidden');

    walletNfts.forEach((item) => {
      const card = document.createElement('article');
      card.className = `wallet-nft-card${item.rarityId ? ' is-compatible' : ''}`;
      if (item.rarityId) card.dataset.rarity = item.rarityId;

      const image = item.image || item.fallbackPoster;
      const badge = item.rarityId
        ? `<span class="wallet-nft-badge" data-rarity="${escapeHtml(item.rarityId)}">${escapeHtml(item.rarityId)}</span>`
        : '';
      const collection = item.collectionName || formatWalletAddress(item.address) || t('wallet.nftUnknownCollection', 'Collection');

      card.innerHTML = `
        <div class="wallet-nft-media">
          ${image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}" loading="lazy" referrerpolicy="no-referrer">`
            : `<div class="wallet-nft-placeholder">${escapeHtml((item.name || 'NFT').slice(0, 1).toUpperCase())}</div>`}
          ${badge}
        </div>
        <div class="wallet-nft-meta">
          <div class="wallet-nft-name">${escapeHtml(item.name)}</div>
          <div class="wallet-nft-collection">${escapeHtml(collection)}</div>
        </div>
      `;

      walletNftGrid.appendChild(card);
    });
  }

  function renderPaymentsStatus() {
    const {
      walletPaymentModeValue,
      walletPaymentStatusValue
    } = dom;

    if (!walletPaymentModeValue && !walletPaymentStatusValue) return;

    const data = paymentsStatus.data || {};
    const mode = String(data.mode || data.network || 'testnet');
    const isConfigured = data.configured === true || data.ready === true;

    if (walletPaymentModeValue) {
      walletPaymentModeValue.textContent = mode;
    }

    if (!walletPaymentStatusValue) return;

    if (paymentsStatus.loading) {
      walletPaymentStatusValue.textContent = t('payments.statusChecking', 'Checking payment status...');
      walletPaymentStatusValue.dataset.status = 'loading';
      return;
    }

    if (paymentsStatus.error) {
      walletPaymentStatusValue.textContent = t('payments.statusUnavailable', 'Payment status is unavailable.');
      walletPaymentStatusValue.dataset.status = 'error';
      return;
    }

    walletPaymentStatusValue.textContent = isConfigured
      ? t('payments.statusReady', 'TON payments are ready.')
      : t('payments.statusReceiverMissing', 'Payment receiver is not configured. TON orders are disabled.');
    walletPaymentStatusValue.dataset.status = isConfigured ? 'ready' : 'not_configured';
  }

  function updateWalletUI() {
    const {
      navWalletBtn,
      navWalletLabel,
      walletStatusText,
      walletAddressValue,
      walletTonBalanceValue,
      walletConnectActionBtn,
      walletDisconnectBtn,
      walletReferralInput,
      shopReceiverInput,
      walletCopyAddressBtn
    } = dom;

    if (navWalletBtn && navWalletLabel) {
      navWalletLabel.textContent = tonWalletAddress
        ? formatWalletLabel(tonWalletAddress)
        : t('nav.wallet', 'WALLET');
      navWalletBtn.classList.toggle('connected', !!tonWalletAddress);
    }

    if (walletStatusText) {
      walletStatusText.textContent = tonWalletAddress
        ? t('wallet.statusConnected', 'Connected')
        : t('wallet.statusDisconnected', 'Not connected');
    }

    if (walletAddressValue) {
      walletAddressValue.textContent = tonWalletAddress || t('wallet.notConnected', 'TON wallet not connected');
    }

    if (walletTonBalanceValue) {
      walletTonBalanceValue.textContent = formatTonValue(getTonBalanceTon());
    }

    if (walletConnectActionBtn) {
      walletConnectActionBtn.textContent = tonWalletAddress
        ? t('wallet.reconnect', 'Reconnect TON')
        : t('wallet.connect', 'Connect TON');
    }

    if (walletDisconnectBtn) {
      walletDisconnectBtn.disabled = !tonWalletAddress;
    }

    if (walletCopyAddressBtn) {
      walletCopyAddressBtn.disabled = !tonWalletAddress;
    }

    if (walletReferralInput) {
      walletReferralInput.value = getReferralLink();
    }

    if (shopReceiverInput && document.activeElement !== shopReceiverInput) {
      shopReceiverInput.value = shopTonReceiverAddress;
    }

    renderPaymentsStatus();
    renderWalletNfts();
  }

  async function refreshPaymentsStatus() {
    if (typeof getPaymentsStatus !== 'function') {
      paymentsStatus = {
        loading: false,
        data: null,
        error: 'payment_status_unavailable'
      };
      renderPaymentsStatus();
      return paymentsStatus;
    }

    paymentsStatus = { ...paymentsStatus, loading: true, error: '' };
    renderPaymentsStatus();
    try {
      const data = await getPaymentsStatus();
      paymentsStatus = {
        loading: false,
        data: data || null,
        error: ''
      };
    } catch (error) {
      paymentsStatus = {
        loading: false,
        data: null,
        error: error?.code || 'payment_status_unavailable'
      };
    }
    renderPaymentsStatus();
    return paymentsStatus;
  }

  async function fetchTonBalance() {
    if (!tonWalletAddress) {
      setTonBalanceNano(0);
      return;
    }

    const endpoints = buildTonBalanceEndpoints(tonWalletAddress);
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        const maybeBalance = Number(data?.balance ?? data?.result ?? 0);
        if (Number.isFinite(maybeBalance) && maybeBalance >= 0) {
          setTonBalanceNano(maybeBalance);
          return;
        }
      } catch {
        // try next endpoint
      }
    }
  }

  async function fetchWalletNfts() {
    if (!tonWalletAddress) {
      setWalletNfts([], { loading: false, error: '' });
      return [];
    }

    setWalletNfts(walletNfts, { loading: true, error: '' });
    const endpoints = buildTonNftEndpoints(tonWalletAddress);

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        const items = normalizeWalletNfts(data, rarities);
        setWalletNfts(items, { loading: false, error: '' });
        return items;
      } catch {
        // try next endpoint
      }
    }

    const errorText = t('wallet.nftLoadFailed', 'Failed to load wallet NFTs.');
    setWalletNfts([], { loading: false, error: errorText });
    return [];
  }

  function restartTonBalanceTimer() {
    if (tonBalanceRefreshTimer) clearInterval(tonBalanceRefreshTimer);
    tonBalanceRefreshTimer = null;
    if (!tonWalletAddress) return;
    tonBalanceRefreshTimer = setInterval(() => {
      fetchTonBalance().catch(() => { });
      fetchWalletNfts().catch(() => { });
    }, tonBalanceRefreshMs);
  }

  async function waitForPaymentOrder(orderId) {
    if (typeof getPaymentOrderStatus !== 'function') return { status: 'pending' };
    const startedAt = Date.now();
    const timeoutMs = 75_000;
    const intervalMs = 2_500;

    while (Date.now() - startedAt < timeoutMs) {
      const result = await getPaymentOrderStatus(orderId);
      const status = result?.order?.status || 'pending';
      if (status === 'paid') return result;
      if (['expired', 'cancelled', 'failed'].includes(status)) return result;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return { order: { orderId, status: 'pending' }, timedOut: true };
  }

  async function executeServerPreparedTonPayment({ itemId, idempotencyPrefix }) {
    if (!tonConnectUI || typeof tonConnectUI.sendTransaction !== 'function') {
      showToast(t('wallet.toast.loadingConnect', 'TON Connect is loading, try again'));
      return { ok: false, reason: 'ton_connect_unavailable' };
    }
    if (!tonWalletAddress) {
      showToast(t('shop.toast.connectWallet', 'Connect wallet first'));
      await openTonConnectFlow();
      return { ok: false, reason: 'wallet_not_connected' };
    }
    if (typeof createPaymentOrder !== 'function') {
      return { ok: false, reason: 'payment_api_unavailable' };
    }

    const orderResponse = await createPaymentOrder({
      itemId,
      idempotencyKey: buildIdempotencyKey(idempotencyPrefix)
    });

    const orderId = orderResponse?.order?.orderId;
    const transaction = orderResponse?.transaction;
    if (!orderId || !transaction) {
      return { ok: false, reason: 'invalid_payment_order' };
    }

    await tonConnectUI.sendTransaction(transaction);
    showToast(t('payments.pending', 'Payment sent. Waiting for confirmation...'));

    const paidResult = await waitForPaymentOrder(orderId);
    const status = paidResult?.order?.status || 'pending';
    if (status === 'paid') {
      if (typeof refreshServerState === 'function') {
        await refreshServerState({ persist: true, silent: true });
      }
      showToast(t('payments.paid', 'Payment confirmed'));
      return { ok: true, status, order: paidResult.order };
    }

    if (status === 'expired') {
      showToast(t('payments.expired', 'Payment order expired'));
      return { ok: false, reason: 'expired', order: paidResult.order };
    }

    showToast(t('payments.pendingLong', 'Payment is still pending. It will be applied after confirmation.'));
    return { ok: false, reason: paidResult?.timedOut ? 'pending_timeout' : status, order: paidResult?.order };
  }

  async function purchaseShopItemWithTon(rarity) {
    if (!rarity?.id) return { ok: false, reason: 'invalid_rarity' };
    return executeServerPreparedTonPayment({
      itemId: `nft_card:${rarity.id}`,
      idempotencyPrefix: `payment-nft-${rarity.id}`
    });
  }

  async function purchaseTimedTonBoost(plan) {
    if (!plan?.id) return { ok: false, reason: 'invalid_plan' };
    return executeServerPreparedTonPayment({
      itemId: plan.id,
      idempotencyPrefix: `payment-ton-boost-${plan.id}`
    });
  }

  async function openTonConnectFlow() {
    if (!tonConnectUI) {
      showToast(t('wallet.toast.loadingConnect', 'TON Connect is loading, try again'));
      return;
    }

    try {
      await refreshTonProofPayload();
      await tonConnectUI.openModal();
    } catch (err) {
      console.error('TON Connect modal open failed', err);
      showToast(t('wallet.toast.openFailed', 'Failed to open TON Connect'));
    }
  }

  async function disconnectTonWallet() {
    if (!tonConnectUI || !tonWalletAddress) return;
    try {
      await tonConnectUI.disconnect();
    } catch (err) {
      console.error('TON disconnect failed', err);
    }
    setTonWallet('');
    setTonBalanceNano(0);
    setWalletNfts([], { loading: false, error: '' });
    restartTonBalanceTimer();
    showToast(t('wallet.toast.disconnected', 'TON wallet disconnected'));
  }

  async function initTonConnect() {
    try {
      tonConnectUI = new TonConnectUIClass({ manifestUrl: tonManifestUrl });

      tonConnectUI.onStatusChange((wallet) => {
        const nextAddress = wallet?.account?.address || '';
        setTonWallet(nextAddress);
        if (!nextAddress) {
          setTonBalanceNano(0);
          setWalletNfts([], { loading: false, error: '' });
        } else {
          verifyWalletTonProof(wallet).catch(() => { });
          fetchTonBalance().catch(() => { });
          fetchWalletNfts().catch(() => { });
        }
        restartTonBalanceTimer();
      });

      refreshTonProofPayload().catch(() => { });

      if (tonConnectUI.connectionRestored && typeof tonConnectUI.connectionRestored.then === 'function') {
        tonConnectUI.connectionRestored
          .then(() => {
            const restoredAddress = tonConnectUI.wallet?.account?.address || '';
            setTonWallet(restoredAddress);
          })
          .catch((err) => {
            console.error('TON connection restore failed', err);
          });
      }

      const activeAddress = tonConnectUI.wallet?.account?.address || tonWalletAddress;
      setTonWallet(activeAddress);
      if (activeAddress) {
        fetchTonBalance().catch(() => { });
        fetchWalletNfts().catch(() => { });
      } else {
        setTonBalanceNano(0);
        setWalletNfts([], { loading: false, error: '' });
      }
      restartTonBalanceTimer();
    } catch (err) {
      console.error('TON Connect init failed', err);
      showToast(t('wallet.toast.unavailable', 'TON Connect is currently unavailable'));
    }
  }

  return {
    getTonWalletAddress,
    getShopTonReceiverAddress,
    getTonBalanceTon,
    getWalletNfts,
    updateWalletUI,
    setShopTonReceiverAddress,
    refreshPaymentsStatus,
    fetchTonBalance,
    fetchWalletNfts,
    purchaseShopItemWithTon,
    purchaseTimedTonBoost,
    openTonConnectFlow,
    disconnectTonWallet,
    initTonConnect
  };
}
