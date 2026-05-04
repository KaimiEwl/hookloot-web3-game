export const COIN_UNIT = 1_000_000n;
export const CATALOG_VERSION = '2026-04-stage4';
export const NFT_ITEM_ID = 'nft_card';
export const ACTIVE_SLOT_COUNT = 5;

export function decimalToUnits(value, unit = COIN_UNIT) {
  const source = String(value);
  const negative = source.startsWith('-');
  const normalized = negative ? source.slice(1) : source;
  const [wholePart = '0', rawFraction = ''] = normalized.split('.');
  const unitDigits = String(unit).length - 1;
  const fraction = rawFraction.padEnd(unitDigits, '0').slice(0, unitDigits);
  const wholeUnits = BigInt(wholePart || '0') * unit;
  const fractionUnits = BigInt(fraction || '0');
  const result = wholeUnits + fractionUnits;
  return negative ? -result : result;
}

export function unitsToDecimalString(value, unit = COIN_UNIT, fractionDigits = 6) {
  const units = BigInt(value || 0);
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / unit;
  const fraction = absolute % unit;
  const unitDigits = String(unit).length - 1;
  const fractionText = fraction
    .toString()
    .padStart(unitDigits, '0')
    .slice(0, fractionDigits);
  const trimmed = fractionText.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${trimmed ? `.${trimmed}` : ''}`;
}

export const RARITY_CATALOG = [
  {
    id: 'common',
    itemId: NFT_ITEM_ID,
    name: 'Common',
    costUnits: decimalToUnits('5'),
    boostUnitsPerSecond: decimalToUnits('0.003')
  },
  {
    id: 'rare',
    itemId: NFT_ITEM_ID,
    name: 'Rare',
    costUnits: decimalToUnits('10'),
    boostUnitsPerSecond: decimalToUnits('0.0075')
  },
  {
    id: 'epic',
    itemId: NFT_ITEM_ID,
    name: 'Epic',
    costUnits: decimalToUnits('20'),
    boostUnitsPerSecond: decimalToUnits('0.018')
  },
  {
    id: 'legendary',
    itemId: NFT_ITEM_ID,
    name: 'Legendary',
    costUnits: decimalToUnits('40'),
    boostUnitsPerSecond: decimalToUnits('0.045')
  },
  {
    id: 'gold',
    itemId: NFT_ITEM_ID,
    name: 'Gold',
    costUnits: decimalToUnits('500'),
    boostUnitsPerSecond: 0n,
    incomeMultiplier: 5
  }
];

export const RARITY_BY_ID = Object.fromEntries(RARITY_CATALOG.map((rarity) => [rarity.id, rarity]));
export const COIN_BOOST_LEVELS = [
  { level: 1, costUnits: decimalToUnits('100'), rewardUnitsPerSecond: decimalToUnits('0.0007') },
  { level: 2, costUnits: decimalToUnits('150'), rewardUnitsPerSecond: decimalToUnits('0.0009') },
  { level: 3, costUnits: decimalToUnits('220'), rewardUnitsPerSecond: decimalToUnits('0.0011') },
  { level: 4, costUnits: decimalToUnits('320'), rewardUnitsPerSecond: decimalToUnits('0.0014') },
  { level: 5, costUnits: decimalToUnits('460'), rewardUnitsPerSecond: decimalToUnits('0.0018') },
  { level: 6, costUnits: decimalToUnits('660'), rewardUnitsPerSecond: decimalToUnits('0.0022') },
  { level: 7, costUnits: decimalToUnits('940'), rewardUnitsPerSecond: decimalToUnits('0.0027') },
  { level: 8, costUnits: decimalToUnits('1340'), rewardUnitsPerSecond: decimalToUnits('0.0033') },
  { level: 9, costUnits: decimalToUnits('1900'), rewardUnitsPerSecond: decimalToUnits('0.0040') },
  { level: 10, costUnits: decimalToUnits('2700'), rewardUnitsPerSecond: decimalToUnits('0.0048') }
];

export const NFT_BOOST_PROGRESSION = {
  common: { startUnitsPerHour: decimalToUnits('15'), stepUnitsPerHour: decimalToUnits('5') },
  rare: { startUnitsPerHour: decimalToUnits('30'), stepUnitsPerHour: decimalToUnits('10') },
  epic: { startUnitsPerHour: decimalToUnits('60'), stepUnitsPerHour: decimalToUnits('20') },
  legendary: { startUnitsPerHour: decimalToUnits('120'), stepUnitsPerHour: decimalToUnits('40') },
  gold: { startUnitsPerHour: decimalToUnits('600'), stepUnitsPerHour: decimalToUnits('0'), maxLevel: 1 }
};

export const BOOST_TYPES = {
  COIN: 'coin',
  NFT_PREFIX: 'nft:',
  TON_MULTIPLIER: 'ton_multiplier'
};

export const SERVER_CATALOG = {
  version: CATALOG_VERSION,
  nftItemId: NFT_ITEM_ID,
  activeSlotCount: ACTIVE_SLOT_COUNT,
  rarities: RARITY_CATALOG,
  coinBoostLevels: COIN_BOOST_LEVELS,
  nftBoostProgression: NFT_BOOST_PROGRESSION
};
