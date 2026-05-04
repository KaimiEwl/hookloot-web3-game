import test from 'node:test';
import assert from 'node:assert/strict';

import { BOOST_TYPES, decimalToUnits } from '../../shared/domain/catalog.js';
import {
  buildBoostState,
  calculateGoldMultiplier,
  calculateIncomeUnitsPerHour,
  calculateIncomeUnitsPerSecond,
  calculateMiningDeltaUnits
} from '../../shared/domain/mining.js';
import {
  applyAccrualToLockedAccount,
  buildMiningAccrualLedgerEvent,
  shouldWriteAccrualLedgerEvent
} from '../src/game/repository.js';

const config = {
  miningMaxOfflineSeconds: 86400,
  miningPersistIntervalSeconds: 30
};

test('mining accrues integer balance for elapsed time', () => {
  const now = new Date('2026-04-27T12:01:00.000Z');
  const incomeUnitsPerSecond = decimalToUnits('0.003');
  const result = calculateMiningDeltaUnits({
    lastMinedAt: new Date('2026-04-27T12:00:00.000Z'),
    now,
    incomeUnitsPerSecond,
    maxOfflineSeconds: 86400
  });

  assert.equal(result.elapsedSeconds, 60);
  assert.equal(result.amountDeltaUnits, decimalToUnits('0.18'));
});

test('mining accrual applies max offline cap', () => {
  const result = calculateMiningDeltaUnits({
    lastMinedAt: new Date('2026-04-20T00:00:00.000Z'),
    now: new Date('2026-04-27T00:00:00.000Z'),
    incomeUnitsPerSecond: decimalToUnits('1'),
    maxOfflineSeconds: 86400
  });

  assert.equal(result.elapsedSeconds, 604800);
  assert.equal(result.cappedSeconds, 86400);
  assert.equal(result.amountDeltaUnits, decimalToUnits('86400'));
});

test('gold active slots multiply total income linearly by gold count', () => {
  assert.equal(calculateGoldMultiplier({ gold: 0 }), 1);
  assert.equal(calculateGoldMultiplier({ gold: 1 }), 5);
  assert.equal(calculateGoldMultiplier({ gold: 2 }), 10);
});

test('coin and nft boost states increase income', () => {
  const boostStates = [
    buildBoostState(BOOST_TYPES.COIN, 1),
    buildBoostState('nft:common', 1)
  ];
  const incomePerSecond = calculateIncomeUnitsPerSecond({
    activeSlotCounts: { common: 1, gold: 1 },
    boostStates,
    now: new Date('2026-04-27T12:00:00.000Z')
  });
  const incomePerHour = calculateIncomeUnitsPerHour({
    activeSlotCounts: { common: 1, gold: 1 },
    boostStates,
    now: new Date('2026-04-27T12:00:00.000Z')
  });

  assert.ok(incomePerSecond > decimalToUnits('0.003'));
  assert.equal(incomePerHour, incomePerSecond * 3600n);
});

test('repeated persisted accrual does not duplicate income when lastMinedAt is updated', () => {
  const account = {
    balanceUnits: 0n,
    lastMinedAt: new Date('2026-04-27T12:00:00.000Z')
  };
  const now = new Date('2026-04-27T12:01:00.000Z');
  const first = applyAccrualToLockedAccount({
    account,
    activeSlotCounts: { common: 1 },
    boostRows: [],
    now,
    config
  });
  account.balanceUnits = first.balanceAfter;
  account.lastMinedAt = now;

  const second = applyAccrualToLockedAccount({
    account,
    activeSlotCounts: { common: 1 },
    boostRows: [],
    now,
    config
  });

  assert.equal(first.amountDeltaUnits, decimalToUnits('0.18'));
  assert.equal(second.amountDeltaUnits, 0n);
  assert.equal(second.balanceAfter, first.balanceAfter);
});

test('simulated concurrent sync with a serial lock does not duplicate income', async () => {
  const account = {
    balanceUnits: 0n,
    lastMinedAt: new Date('2026-04-27T12:00:00.000Z')
  };
  const now = new Date('2026-04-27T12:01:00.000Z');
  let lock = Promise.resolve();

  async function withLock(fn) {
    const previous = lock;
    let release;
    lock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return fn();
    } finally {
      release();
    }
  }

  const runSync = () => withLock(() => {
    const result = applyAccrualToLockedAccount({
      account,
      activeSlotCounts: { common: 1 },
      boostRows: [],
      now,
      config
    });
    account.balanceUnits = result.balanceAfter;
    account.lastMinedAt = now;
    return result;
  });

  const results = await Promise.all([runSync(), runSync()]);
  const totalDelta = results.reduce((sum, item) => sum + item.amountDeltaUnits, 0n);

  assert.equal(totalDelta, decimalToUnits('0.18'));
  assert.equal(account.balanceUnits, decimalToUnits('0.18'));
});

test('ledger event is created only when persisted accrual has positive delta', () => {
  const zero = {
    amountDeltaUnits: 0n,
    balanceBefore: 10n,
    balanceAfter: 10n,
    elapsedSeconds: 0,
    cappedSeconds: 0,
    incomeUnitsPerSecond: 1n
  };
  const positive = {
    ...zero,
    amountDeltaUnits: 5n,
    balanceAfter: 15n,
    elapsedSeconds: 5,
    cappedSeconds: 5
  };

  assert.equal(shouldWriteAccrualLedgerEvent(zero), false);
  assert.equal(buildMiningAccrualLedgerEvent({
    userId: 'user-1',
    accrual: zero,
    source: 'test'
  }), null);
  assert.equal(shouldWriteAccrualLedgerEvent(positive), true);
  assert.equal(buildMiningAccrualLedgerEvent({
    userId: 'user-1',
    accrual: positive,
    source: 'test'
  })?.eventType, 'mining_accrual');
});
