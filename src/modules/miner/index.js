export function calculateSlotBoostPerSec(state, rarities) {
  let slotBoost = 0;
  rarities.forEach((rarity) => {
    if (state.activeSlots[rarity.id] > 0) {
      slotBoost += Number(rarity.boost || 0) * state.activeSlots[rarity.id];
    }
  });
  return slotBoost;
}

export function calculateIncomeMultiplier(state, rarities, boostMultiplier = 1) {
  const extraMultiplier = Math.max(1, Number(boostMultiplier || 1));
  const goldRarity = rarities.find((rarity) => rarity.id === 'gold');
  const goldCount = Math.max(0, Number(state.activeSlots?.gold || 0));
  const goldMultiplier = goldRarity && goldCount > 0
    ? Math.max(1, Number(goldRarity.incomeMultiplier || 1) * goldCount)
    : 1;
  return extraMultiplier * goldMultiplier;
}

export function calculateCurrentBoostPerSec(state, rarities, questBoostPerSec = 0, coinBoostPerSec = 0, boostMultiplier = 1) {
  const baseBoost = calculateSlotBoostPerSec(state, rarities) + Number(questBoostPerSec || 0) + Number(coinBoostPerSec || 0);
  return baseBoost * calculateIncomeMultiplier(state, rarities, boostMultiplier);
}

export function applyMiningTick(state, rarities, questBoostPerSec = 0, now = Date.now(), coinBoostPerSec = 0, boostMultiplier = 1) {
  const dt = (now - state.lastUpdate) / 1000;
  const currentBoost = calculateCurrentBoostPerSec(state, rarities, questBoostPerSec, coinBoostPerSec, boostMultiplier);
  const balanceDelta = currentBoost > 0 ? currentBoost * dt : 0;
  return { dt, currentBoost, balanceDelta, projectedBalance: Number(state.balance || 0) + balanceDelta };
}
