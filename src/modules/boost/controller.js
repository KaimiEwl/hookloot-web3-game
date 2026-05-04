import {
  getActivatedBoostPerSec,
  getOwnedRarityCountForBoost,
  getQuestLevelRewardPerSec,
  getQuestTotalRewardPerSec
} from './index.js';

function defaultTranslate(_key, fallback, vars = {}) {
  let text = fallback;
  Object.entries(vars).forEach(([name, value]) => {
    text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
  });
  return text;
}

export function createBoostController({
  state,
  rarities,
  boostQuests,
  coinBoostLevels,
  tonBoostPlans,
  boostQuestListEl,
  boostCoinListEl,
  boostTonListEl,
  boostTotalPerSecEl,
  boostCoinPerSecEl,
  saveState,
  updateStats,
  showToast,
  onNeedNft,
  onBoostActivated,
  onCoinBoostPurchased,
  onTonBoostPurchased,
  economyActionsEnabled = true,
  onServerActionPending,
  t = defaultTranslate
}) {
  const NFT_BOOST_MAX_LEVEL = 10;

  function formatBoost(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    const abs = Math.abs(num);
    const fixed = abs >= 1 ? num.toFixed(2) : abs >= 0.01 ? num.toFixed(3) : num.toFixed(4);
    return fixed.replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1');
  }

  function formatPerHour(value) {
    return formatBoost(Number(value || 0) * 3600);
  }

  function formatDurationLeft(timestamp) {
    const msLeft = Math.max(0, Number(timestamp || 0) - Date.now());
    const totalMinutes = Math.ceil(msLeft / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return t('boost.tonRemainingMinutes', '{minutes}m left', { minutes });
    if (minutes <= 0) return t('boost.tonRemainingHours', '{hours}h left', { hours });
    return t('boost.tonRemainingHoursMinutes', '{hours}h {minutes}m left', { hours, minutes });
  }

  function getCollectionBoostPerSecValue() {
    return getActivatedBoostPerSec(boostQuests, state.activatedBoostTasks);
  }

  function getCoinBoostPerSecValue() {
    const count = Math.max(0, Math.min(coinBoostLevels.length, Number(state.coinBoostLevel) || 0));
    return coinBoostLevels.slice(0, count).reduce((sum, item) => sum + Number(item.rewardPerSec || 0), 0);
  }

  function getTonBoostMultiplierValue() {
    const activeUntil = Number(state.tonBoost?.activeUntil || 0);
    if (activeUntil <= Date.now()) return 1;
    return Math.max(1, Number(state.tonBoost?.multiplier || 1));
  }

  function getTotalBoostPerSecValue() {
    return getCollectionBoostPerSecValue() + getCoinBoostPerSecValue();
  }

  function getQuestProgressState(quest) {
    const owned = getOwnedRarityCountForBoost(state, quest?.rarityId);
    const maxLevels = Math.max(1, Number(quest?.maxLevel || NFT_BOOST_MAX_LEVEL));
    const activatedCount = Math.max(0, Math.min(maxLevels, Number(state?.activatedBoostTasks?.[quest?.id] || 0)));
    const isMaxed = activatedCount >= maxLevels;
    const nextLevel = isMaxed ? maxLevels : (activatedCount + 1);
    const requiredTotal = nextLevel;
    const needed = isMaxed ? 0 : Math.max(0, requiredTotal - owned);
    const ready = !isMaxed && needed <= 0;
    return { owned, activatedCount, nextLevel, requiredTotal, needed, ready, isMaxed, maxLevels };
  }

  function activateBoostQuest(questId) {
    const quest = boostQuests.find((q) => q.id === questId);
    if (!quest) return;
    if (typeof onServerActionPending === 'function') {
      onServerActionPending('nft_boost', { quest });
      return;
    }
    void economyActionsEnabled;
    const progressState = getQuestProgressState(quest);
    if (!progressState.ready && typeof onNeedNft === 'function') {
      onNeedNft(quest, progressState);
      return;
    }
      showToast(t('toast.serverActionPending', 'Server action is coming soon'));
      return;
  }

  function purchaseCoinBoost() {
    if (typeof onServerActionPending === 'function') {
      onServerActionPending('coin_boost');
      return;
    }
    void economyActionsEnabled;
    showToast(t('toast.serverActionPending', 'Server action is coming soon'));
  }

  async function purchaseTonBoost(planId) {
    const plan = tonBoostPlans.find((item) => item.id === planId);
    if (!plan) return;
    if (typeof onServerActionPending === 'function') {
      onServerActionPending('ton_boost', { plan });
      return;
    }
    void economyActionsEnabled;
    void onTonBoostPurchased;
    showToast(t('toast.serverActionPending', 'Server action is coming soon'));
  }

  function renderCollectionQuestRows() {
    if (!boostQuestListEl) return;
    boostQuestListEl.innerHTML = '';

    boostQuests.forEach((quest) => {
      const rarity = rarities.find((r) => r.id === quest.rarityId);
      if (!rarity) return;

      const questState = getQuestProgressState(quest);
      const ready = questState.ready;
      const activeCount = questState.activatedCount;
      const nextRewardHour = formatPerHour(getQuestLevelRewardPerSec(quest, questState.nextLevel));
      const totalRewardHour = formatPerHour(getQuestTotalRewardPerSec(quest, activeCount));
      const owned = questState.owned;
      const requiredTotal = questState.requiredTotal;
      const nextLevel = questState.nextLevel;
      const levelLabel = `${Math.min(nextLevel, questState.maxLevels)}/${questState.maxLevels}`;
      const actionLabel = questState.isMaxed
        ? t('boost.nftMaxLabel', 'Activated')
        : ready
          ? t('boost.nftActivateAction', 'Activate +{boost} /hour', { boost: nextRewardHour })
          : t('boost.nftBuyAction', 'Buy +{boost} /hour', { boost: nextRewardHour });
      const noteText = questState.isMaxed
        ? t('boost.nftTotalLabel', 'Total +{boost} /hour', { boost: totalRewardHour })
        : ready
          ? t('boost.nftProgressLabel', 'Ready: {owned}/{required} NFT', { owned, required: requiredTotal })
          : t('boost.nftNeedHint', 'To upgrade you need {required}/10 NFT', { required: requiredTotal });

      const row = document.createElement('div');
      row.className = `boost-quest-item ${activeCount > 0 ? 'active' : ''}`;
      row.dataset.rarity = rarity.id;
      row.innerHTML = `
        <button
          class="boost-activate-btn boost-activate-btn-wide ${!ready && !questState.isMaxed ? 'is-awaiting' : ''} ${ready ? 'is-ready' : ''}"
          data-rarity="${rarity.id}"
          data-quest-id="${quest.id}"
        >
          <span class="boost-nft-head">
            <span class="boost-rarity-name" data-rarity="${rarity.id}">${rarity.name}</span>
            <span class="boost-level-chip">${levelLabel}</span>
          </span>
          <span class="boost-action-main">${actionLabel}</span>
          <span class="boost-action-sub">${noteText}</span>
        </button>
      `;
      boostQuestListEl.appendChild(row);
    });
  }

  function renderCoinBoostRows() {
    if (!boostCoinListEl) return;
    boostCoinListEl.innerHTML = '';

    const currentLevel = Number(state.coinBoostLevel) || 0;
    const nextUpgrade = coinBoostLevels[currentLevel] || null;
    const isMaxed = currentLevel >= coinBoostLevels.length;
    const affordable = nextUpgrade ? Number(state.balance || 0) >= Number(nextUpgrade.cost || 0) : false;

    const card = document.createElement('div');
    card.className = `boost-coin-panel ${isMaxed ? 'is-maxed' : 'is-current'}`;

    if (isMaxed || !nextUpgrade) {
      card.innerHTML = `
        <button class="boost-coin-buy-btn" disabled>
          <span class="boost-action-main">${t('boost.coinMaxLabel', 'Max level')}</span>
          <span class="boost-action-sub">+${formatPerHour(getCoinBoostPerSecValue())} / hour</span>
        </button>
      `;
    } else {
      card.innerHTML = `
        <button
          class="boost-coin-buy-btn"
          data-coin-level="${nextUpgrade.level}"
          ${affordable ? '' : 'disabled'}
        >
          <span class="boost-action-main">${t('boost.coinBuyAction', 'Buy {cost} Coins', { cost: Number(nextUpgrade.cost || 0).toLocaleString('en-US') })}</span>
          <span class="boost-action-sub">+${formatPerHour(nextUpgrade.rewardPerSec)} / hour</span>
        </button>
      `;
    }

    boostCoinListEl.appendChild(card);
  }

  function renderTonBoostRows() {
    if (!boostTonListEl) return;
    boostTonListEl.innerHTML = '';

    const activePlanId = String(state.tonBoost?.planId || '');
    const activeMultiplier = getTonBoostMultiplierValue();
    const activeUntil = Number(state.tonBoost?.activeUntil || 0);

    tonBoostPlans.forEach((plan) => {
      const isActive = activePlanId === plan.id && activeUntil > Date.now();
      const activeLabel = isActive
        ? t('boost.tonActiveAction', 'Active x{multiplier}', { multiplier: plan.multiplier })
        : t('boost.tonBuyAction', 'Activate x{multiplier}', { multiplier: plan.multiplier });
      const activeHint = isActive
        ? formatDurationLeft(activeUntil)
        : t('boost.tonBuySub', '{ton} TON / {hours} hours', { ton: plan.tonCost, hours: plan.durationHours || 24 });

      const card = document.createElement('div');
      card.className = `boost-ton-card${isActive ? ' is-active' : ''}`;
      card.innerHTML = `
        <button class="boost-ton-buy-btn" data-ton-boost-id="${plan.id}">
          <span class="boost-ton-badge">x${plan.multiplier}</span>
          <span class="boost-ton-copy">
            <span class="boost-action-main">${activeLabel}</span>
            <span class="boost-action-sub">${activeHint}</span>
          </span>
          <span class="boost-ton-price">${plan.tonCost} TON</span>
        </button>
      `;
      boostTonListEl.appendChild(card);
    });

    if (activeMultiplier > 1) {
      const current = document.createElement('div');
      current.className = 'boost-ton-current';
      current.textContent = t('boost.tonCurrentStatus', 'Current TON boost: x{multiplier}', {
        multiplier: activeMultiplier
      });
      boostTonListEl.appendChild(current);
    }
  }

  function renderBoostTasks() {
    renderCoinBoostRows();
    renderTonBoostRows();
    renderCollectionQuestRows();

    if (boostCoinPerSecEl) {
      boostCoinPerSecEl.textContent = `+${formatPerHour(getCoinBoostPerSecValue())} / HOUR`;
    }
    if (boostTotalPerSecEl) {
      boostTotalPerSecEl.textContent = `+${formatPerHour(getTotalBoostPerSecValue())} / HOUR`;
    }
  }

  return {
    getActivatedBoostPerSec: getCollectionBoostPerSecValue,
    getCoinBoostPerSec: getCoinBoostPerSecValue,
    getTonBoostMultiplier: getTonBoostMultiplierValue,
    activateBoostQuest,
    purchaseCoinBoost,
    purchaseTonBoost,
    renderBoostTasks
  };
}
