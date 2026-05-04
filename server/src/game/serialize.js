import { unitsToDecimalString } from '../../../shared/domain/catalog.js';
import { calculateIncomeUnitsPerHour } from '../../../shared/domain/mining.js';

function serializeBigInt(value) {
  return BigInt(value || 0).toString();
}

function serializeMoney(value) {
  const units = BigInt(value || 0);
  return {
    units: units.toString(),
    coins: unitsToDecimalString(units)
  };
}

export function serializeGameState(state) {
  const incomeUnitsPerHour = state.incomeUnitsPerHour ?? calculateIncomeUnitsPerHour({
    activeSlotCounts: state.activeSlotCounts,
    boostStates: state.boosts,
    now: state.serverTime
  });

  return {
    balance: serializeMoney(state.balanceUnits),
    balanceUnits: serializeBigInt(state.balanceUnits),
    inventory: state.inventory,
    activeSlots: state.activeSlots,
    boosts: state.boosts,
    incomePerHour: serializeMoney(incomeUnitsPerHour),
    incomePerHourUnits: serializeBigInt(incomeUnitsPerHour),
    serverTime: state.serverTime.toISOString(),
    lastMinedAt: state.lastMinedAt.toISOString(),
    ...(state.nextPersistAt ? { nextPersistAt: state.nextPersistAt.toISOString() } : {})
  };
}
