import { APP_SCREENS, RARITIES, STORAGE_KEYS } from './constants.js';
import { readString, writeString } from './storage.js';

export function createDefaultState() {
  return {
    balance: 0,
    balanceUnits: '0',
    incomePerHourUnits: '0',
    serverStateLoaded: false,
    serverStatus: 'idle',
    serverError: null,
    serverTime: '',
    serverReceivedAt: 0,
    inventory: {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
      gold: 0
    },
    activeSlots: {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
      gold: 0
    },
    collectedTotals: {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
      gold: 0
    },
    activatedBoostTasks: {},
    coinBoostLevel: 0,
    dailyBoostOrb: {
      clicks: 0,
      clickDayKey: '',
      claimedDayKey: '',
      activeUntil: 0
    },
    tonBoost: {
      planId: '',
      multiplier: 1,
      activeUntil: 0
    },
    ui: {
      screen: APP_SCREENS.MINER
    },
    lastUpdate: Date.now()
  };
}

export function normalizeState(candidate) {
  const defaults = createDefaultState();
  const parsed = candidate && typeof candidate === 'object' ? candidate : {};

  const next = {
    ...defaults,
    ...parsed,
    inventory: { ...defaults.inventory, ...(parsed.inventory || {}) },
    activeSlots: { ...defaults.activeSlots, ...(parsed.activeSlots || {}) },
    collectedTotals: { ...defaults.collectedTotals, ...(parsed.collectedTotals || {}) },
    activatedBoostTasks: { ...(parsed.activatedBoostTasks || {}) },
    coinBoostLevel: Number.isFinite(Number(parsed.coinBoostLevel)) ? Number(parsed.coinBoostLevel) : defaults.coinBoostLevel,
    dailyBoostOrb: { ...defaults.dailyBoostOrb, ...(parsed.dailyBoostOrb || {}) },
    tonBoost: { ...defaults.tonBoost, ...(parsed.tonBoost || {}) },
    ui: { ...defaults.ui, ...(parsed.ui || {}) },
    lastUpdate: Date.now()
  };

  RARITIES.forEach((rarity) => {
    const id = rarity.id;
    if (typeof next.inventory[id] !== 'number') next.inventory[id] = 0;
    if (typeof next.activeSlots[id] !== 'number') next.activeSlots[id] = 0;

    const baselineOwned = next.inventory[id] + next.activeSlots[id];
    if (typeof next.collectedTotals[id] !== 'number') {
      next.collectedTotals[id] = baselineOwned;
    } else if (next.collectedTotals[id] < baselineOwned) {
      next.collectedTotals[id] = baselineOwned;
    }
  });

  if (!Object.values(APP_SCREENS).includes(next.ui.screen)) {
    next.ui.screen = APP_SCREENS.MINER;
  }
  next.coinBoostLevel = Math.max(0, Math.min(10, Math.floor(next.coinBoostLevel)));
  next.dailyBoostOrb.clicks = Math.max(0, Math.min(5, Math.floor(Number(next.dailyBoostOrb.clicks) || 0)));
  next.dailyBoostOrb.clickDayKey = String(next.dailyBoostOrb.clickDayKey || '');
  next.dailyBoostOrb.claimedDayKey = String(next.dailyBoostOrb.claimedDayKey || '');
  next.dailyBoostOrb.activeUntil = Math.max(0, Number(next.dailyBoostOrb.activeUntil) || 0);
  next.tonBoost.planId = String(next.tonBoost.planId || '');
  next.tonBoost.multiplier = Math.max(1, Number(next.tonBoost.multiplier) || 1);
  next.tonBoost.activeUntil = Math.max(0, Number(next.tonBoost.activeUntil) || 0);

  return next;
}

export function loadAppState(key) {
  void key;
  const state = normalizeState(null);
  const persistedScreen = readString(STORAGE_KEYS.SCREEN, '');
  if (Object.values(APP_SCREENS).includes(persistedScreen)) {
    state.ui.screen = persistedScreen;
  }
  return state;
}

export function saveAppState(key, state) {
  void key;
  const screen = state?.ui?.screen;
  if (Object.values(APP_SCREENS).includes(screen)) {
    writeString(STORAGE_KEYS.SCREEN, screen);
  }
}
