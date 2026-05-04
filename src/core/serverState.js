import { APP_SCREENS, BOOST_QUESTS, RARITIES } from './constants.js';
import { normalizeState } from './state.js';

const COIN_UNIT = 1_000_000n;
const MS_PER_HOUR = 3_600_000n;

export function emptyRarityCounts() {
  return Object.fromEntries(RARITIES.map((rarity) => [rarity.id, 0]));
}

function toBigInt(value) {
  try {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
    const text = String(value ?? '0').trim();
    return text ? BigInt(text) : 0n;
  } catch {
    return 0n;
  }
}

export function unitsToNumber(value) {
  return Number(toBigInt(value)) / Number(COIN_UNIT);
}

export function formatUnitsForDisplay(value, fractionDigits = 3) {
  const units = toBigInt(value);
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / COIN_UNIT;
  const fraction = absolute % COIN_UNIT;
  const fractionText = fraction
    .toString()
    .padStart(6, '0')
    .slice(0, Math.max(0, fractionDigits));
  return `${negative ? '-' : ''}${whole.toString()}${fractionDigits > 0 ? `.${fractionText}` : ''}`;
}

function buildInventoryCounts(serverInventory = []) {
  const counts = emptyRarityCounts();
  for (const row of Array.isArray(serverInventory) ? serverInventory : []) {
    const rarityId = row?.rarityId;
    if (counts[rarityId] === undefined) continue;
    counts[rarityId] += Math.max(0, Math.floor(Number(row.quantity || 0)));
  }
  return counts;
}

function buildActiveSlotCounts(serverActiveSlots = {}) {
  const counts = emptyRarityCounts();
  const sourceCounts = serverActiveSlots?.counts || {};
  for (const rarity of RARITIES) {
    counts[rarity.id] = Math.max(0, Math.floor(Number(sourceCounts[rarity.id] || 0)));
  }
  return counts;
}

function buildBoostState(serverBoosts = []) {
  const activatedBoostTasks = {};
  let coinBoostLevel = 0;
  const tonBoost = { planId: '', multiplier: 1, activeUntil: 0 };

  for (const boost of Array.isArray(serverBoosts) ? serverBoosts : []) {
    const boostType = String(boost?.boostType || '');
    const level = Math.max(0, Math.floor(Number(boost?.level || 0)));
    if (boostType === 'coin') {
      coinBoostLevel = Math.max(coinBoostLevel, level);
      continue;
    }
    if (boostType === 'ton_multiplier') {
      const activeUntilMs = boost.activeUntil ? new Date(boost.activeUntil).getTime() : 0;
      if (activeUntilMs > Date.now()) {
        tonBoost.planId = String(boost.metadata?.planId || boost.metadata?.plan_id || 'server-ton-boost');
        tonBoost.multiplier = Math.max(1, Number(boost.metadata?.multiplier || 1));
        tonBoost.activeUntil = activeUntilMs;
      }
      continue;
    }
    if (boostType.startsWith('nft:')) {
      const rarityId = boostType.slice(4);
      const quest = BOOST_QUESTS.find((item) => item.rarityId === rarityId);
      if (quest) activatedBoostTasks[quest.id] = level;
    }
  }

  return { activatedBoostTasks, coinBoostLevel, tonBoost };
}

export function applyAuthoritativeGameState(currentState, serverState, { receivedAt = Date.now() } = {}) {
  const ownedInventory = buildInventoryCounts(serverState?.inventory);
  const activeSlots = buildActiveSlotCounts(serverState?.activeSlots);
  const inventory = emptyRarityCounts();
  const collectedTotals = emptyRarityCounts();
  const boostState = buildBoostState(serverState?.boosts);

  for (const rarity of RARITIES) {
    inventory[rarity.id] = Math.max(0, ownedInventory[rarity.id] - activeSlots[rarity.id]);
    collectedTotals[rarity.id] = Math.max(ownedInventory[rarity.id], activeSlots[rarity.id]);
  }

  const next = normalizeState({
    ...currentState,
    balance: unitsToNumber(serverState?.balanceUnits || serverState?.balance?.units || 0),
    balanceUnits: String(serverState?.balanceUnits || serverState?.balance?.units || '0'),
    incomePerHourUnits: String(serverState?.incomePerHourUnits || serverState?.incomePerHour?.units || '0'),
    inventory,
    activeSlots,
    collectedTotals,
    activatedBoostTasks: boostState.activatedBoostTasks,
    coinBoostLevel: boostState.coinBoostLevel,
    tonBoost: boostState.tonBoost,
    serverStateLoaded: true,
    serverStatus: 'ready',
    serverError: null,
    serverTime: String(serverState?.serverTime || ''),
    lastMinedAt: String(serverState?.lastMinedAt || ''),
    nextPersistAt: String(serverState?.nextPersistAt || ''),
    serverReceivedAt: receivedAt,
    ui: {
      screen: Object.values(APP_SCREENS).includes(currentState?.ui?.screen)
        ? currentState.ui.screen
        : APP_SCREENS.MINER
    }
  });

  Object.keys(currentState).forEach((key) => {
    if (!(key in next)) delete currentState[key];
  });
  Object.assign(currentState, next);
  return currentState;
}

export function projectBalanceUnits(state, nowMs = Date.now()) {
  const baseUnits = toBigInt(state?.balanceUnits || 0);
  const incomeUnitsPerHour = toBigInt(state?.incomePerHourUnits || 0);
  if (!state?.serverStateLoaded || incomeUnitsPerHour <= 0n) return baseUnits;

  const receivedAt = Number(state.serverReceivedAt || nowMs);
  const elapsedMs = Math.max(0, Math.floor(Number(nowMs) - receivedAt));
  return baseUnits + (incomeUnitsPerHour * BigInt(elapsedMs)) / MS_PER_HOUR;
}

export function getProjectedBalanceNumber(state, nowMs = Date.now()) {
  return unitsToNumber(projectBalanceUnits(state, nowMs));
}
