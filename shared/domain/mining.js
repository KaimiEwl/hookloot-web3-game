import { BOOST_TYPES, RARITY_BY_ID } from './catalog.js';
import { getActiveTimedMultiplier, getBoostRewardUnitsPerSecond } from './boosts.js';

export function normalizeRarityCounts(value = {}) {
  return Object.fromEntries(
    Object.keys(RARITY_BY_ID).map((rarityId) => [
      rarityId,
      Math.max(0, Math.floor(Number(value?.[rarityId] || 0)))
    ])
  );
}

export function calculateSlotBoostUnitsPerSecond(activeSlotCounts = {}) {
  const counts = normalizeRarityCounts(activeSlotCounts);
  return Object.entries(counts).reduce((total, [rarityId, count]) => {
    const rarity = RARITY_BY_ID[rarityId];
    if (!rarity || count <= 0) return total;
    return total + rarity.boostUnitsPerSecond * BigInt(count);
  }, 0n);
}

export function calculateGoldMultiplier(activeSlotCounts = {}) {
  const counts = normalizeRarityCounts(activeSlotCounts);
  const goldCount = counts.gold || 0;
  const gold = RARITY_BY_ID.gold;
  if (!gold || goldCount <= 0) return 1;
  return Math.max(1, Number(gold.incomeMultiplier || 1) * goldCount);
}

export function calculateIncomeMultiplier({ activeSlotCounts = {}, boostStates = [], now = new Date() } = {}) {
  return calculateGoldMultiplier(activeSlotCounts) * getActiveTimedMultiplier(boostStates, now);
}

export function calculateIncomeUnitsPerSecond({
  activeSlotCounts = {},
  boostStates = [],
  now = new Date()
} = {}) {
  const baseUnitsPerSecond =
    calculateSlotBoostUnitsPerSecond(activeSlotCounts) +
    getBoostRewardUnitsPerSecond(boostStates);
  const multiplier = calculateIncomeMultiplier({ activeSlotCounts, boostStates, now });
  return BigInt(Math.floor(Number(baseUnitsPerSecond) * multiplier));
}

export function calculateIncomeUnitsPerHour(input = {}) {
  return calculateIncomeUnitsPerSecond(input) * 3600n;
}

export function calculateMiningDeltaUnits({
  lastMinedAt,
  now,
  incomeUnitsPerSecond,
  maxOfflineSeconds
}) {
  const lastTime = lastMinedAt instanceof Date ? lastMinedAt.getTime() : new Date(lastMinedAt).getTime();
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(lastTime) || !Number.isFinite(nowTime) || nowTime <= lastTime) {
    return { elapsedSeconds: 0, cappedSeconds: 0, amountDeltaUnits: 0n };
  }

  const elapsedSeconds = Math.floor((nowTime - lastTime) / 1000);
  const cappedSeconds = Math.max(0, Math.min(elapsedSeconds, Math.max(0, Number(maxOfflineSeconds || 0))));
  const amountDeltaUnits = BigInt(cappedSeconds) * BigInt(incomeUnitsPerSecond || 0);
  return { elapsedSeconds, cappedSeconds, amountDeltaUnits };
}

export function buildBoostState(boostType, level = 0, metadata = {}, activeUntil = null) {
  return {
    boostType,
    level,
    metadata,
    activeUntil
  };
}

export function buildNftBoostType(rarityId) {
  return `${BOOST_TYPES.NFT_PREFIX}${rarityId}`;
}
