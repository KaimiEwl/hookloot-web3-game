export function getOwnedRarityCountForBoost(state, rarityId) {
  const collected = Number(state?.collectedTotals?.[rarityId] || 0);
  const inInventory = Number(state?.inventory?.[rarityId] || 0);
  const inSlots = Number(state?.activeSlots?.[rarityId] || 0);
  // Trust the larger value to survive old state mismatches.
  return Math.max(0, collected, inInventory + inSlots);
}

const BOOST_HOURLY_PROGRESSION = {
  common: { start: 15, step: 5 },
  rare: { start: 30, step: 10 },
  epic: { start: 60, step: 20 },
  legendary: { start: 120, step: 40 },
  gold: { start: 300, step: 100 }
};

function toPerSec(hourly) {
  return Number(hourly || 0) / 3600;
}

export function getQuestLevelRewardPerSec(quest, level) {
  const lvl = Math.max(1, Number(level || 1));
  const cfg = BOOST_HOURLY_PROGRESSION[quest?.rarityId];
  if (!cfg) return Number(quest?.rewardPerSec || 0);
  return toPerSec(cfg.start + (lvl - 1) * cfg.step);
}

export function getQuestTotalRewardPerSec(quest, levels) {
  const count = Math.max(0, Number(levels || 0));
  if (count <= 0) return 0;
  let total = 0;
  for (let level = 1; level <= count; level += 1) {
    total += getQuestLevelRewardPerSec(quest, level);
  }
  return total;
}

export function getActivatedBoostPerSec(boostQuests, activatedBoostTasks) {
  return boostQuests.reduce((sum, quest) => {
    const activeCount = Math.max(0, Math.min(10, Number(activatedBoostTasks?.[quest.id] || 0)));
    if (activeCount > 0) return sum + getQuestTotalRewardPerSec(quest, activeCount);
    return sum;
  }, 0);
}

export function isBoostQuestReady(state, quest) {
  const total = getOwnedRarityCountForBoost(state, quest.rarityId);
  const maxLevels = Math.max(1, Number(quest?.maxLevel || 10));
  const activatedCount = Math.max(0, Math.min(maxLevels, Number(state?.activatedBoostTasks?.[quest.id] || 0)));
  if (activatedCount >= maxLevels) return false;
  const requiredTotal = activatedCount + 1;
  return total >= requiredTotal;
}

export function getBoostQuestProgress(state, quest) {
  const total = getOwnedRarityCountForBoost(state, quest.rarityId);
  const maxLevels = Math.max(1, Number(quest?.maxLevel || 10));
  const activatedCount = Math.max(0, Math.min(maxLevels, Number(state?.activatedBoostTasks?.[quest.id] || 0)));
  if (activatedCount >= maxLevels) return maxLevels;
  const requiredTotal = activatedCount + 1;
  return Math.min(requiredTotal, total);
}
