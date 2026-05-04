import { BOOST_TYPES, COIN_BOOST_LEVELS, NFT_BOOST_PROGRESSION } from './catalog.js';

export function clampLevel(level, maxLevel = 10) {
  const value = Math.floor(Number(level || 0));
  return Math.max(0, Math.min(maxLevel, value));
}

export function getCoinBoostRewardUnitsPerSecond(level) {
  const activeLevel = clampLevel(level, COIN_BOOST_LEVELS.length);
  let total = 0n;
  for (const item of COIN_BOOST_LEVELS) {
    if (item.level <= activeLevel) total += item.rewardUnitsPerSecond;
  }
  return total;
}

export function getNftBoostLevelRewardUnitsPerHour(rarityId, level) {
  const cfg = NFT_BOOST_PROGRESSION[rarityId];
  if (!cfg) return 0n;
  const activeLevel = Math.max(1, Math.floor(Number(level || 1)));
  return cfg.startUnitsPerHour + BigInt(activeLevel - 1) * cfg.stepUnitsPerHour;
}

export function getNftBoostRewardUnitsPerHour(rarityId, level) {
  const cfg = NFT_BOOST_PROGRESSION[rarityId];
  if (!cfg) return 0n;
  const activeLevel = clampLevel(level, cfg.maxLevel || 10);
  let total = 0n;
  for (let current = 1; current <= activeLevel; current += 1) {
    total += getNftBoostLevelRewardUnitsPerHour(rarityId, current);
  }
  return total;
}

export function getNftBoostRewardUnitsPerSecond(rarityId, level) {
  return getNftBoostRewardUnitsPerHour(rarityId, level) / 3600n;
}

export function getActiveTimedMultiplier(boostStates, now) {
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  return boostStates.reduce((best, boost) => {
    if (boost.boostType !== BOOST_TYPES.TON_MULTIPLIER) return best;
    if (!boost.activeUntil || new Date(boost.activeUntil).getTime() <= currentTime) return best;
    const multiplier = Number(boost.metadata?.multiplier || 1);
    return Math.max(best, Number.isFinite(multiplier) ? multiplier : 1);
  }, 1);
}

export function getBoostRewardUnitsPerSecond(boostStates) {
  return boostStates.reduce((total, boost) => {
    if (boost.boostType === BOOST_TYPES.COIN) {
      return total + getCoinBoostRewardUnitsPerSecond(boost.level);
    }
    if (boost.boostType?.startsWith(BOOST_TYPES.NFT_PREFIX)) {
      const rarityId = boost.boostType.slice(BOOST_TYPES.NFT_PREFIX.length);
      return total + getNftBoostRewardUnitsPerSecond(rarityId, boost.level);
    }
    return total;
  }, 0n);
}
