import test from 'node:test';
import assert from 'node:assert/strict';

import { BOOST_QUESTS, RARITIES } from '../src/core/constants.js';
import { normalizeState } from '../src/core/state.js';
import { getActivatedBoostPerSec, isBoostQuestReady } from '../src/modules/boost/index.js';
import { buyNftWithMinedBalance, removeNftFromSlot, transferNftToMatchingSlot } from '../src/modules/miner/actions.js';
import { applyMiningTick, calculateSlotBoostPerSec } from '../src/modules/miner/index.js';
import { getSignedCarouselOffset, getSwipeAxisLock, getSwipeThreshold } from '../src/modules/shop/carouselMath.js';
import {
  buildTonBalanceEndpoints,
  buildTonNftEndpoints,
  formatTonValue,
  formatWalletAddress,
  formatWalletLabel,
  normalizeTonAssetUrl,
  normalizeWalletNfts,
  tonToNanoString
} from '../src/modules/wallet/index.js';

test('boost helpers compute reward and readiness', () => {
  const state = normalizeState({
    collectedTotals: { common: 10, rare: 0, epic: 0, legendary: 0, gold: 0 },
    activatedBoostTasks: { 'boost-common-x10': 1 }
  });

  const boost = getActivatedBoostPerSec(BOOST_QUESTS, state.activatedBoostTasks);
  assert.ok(Math.abs(boost - (15 / 3600)) < 1e-12);
  assert.equal(isBoostQuestReady(state, BOOST_QUESTS[0]), true);
  assert.equal(isBoostQuestReady(state, BOOST_QUESTS[1]), false);
});

test('miner helpers compute slot boost and mining tick', () => {
  const state = normalizeState({
    activeSlots: { common: 2, rare: 1, epic: 0, legendary: 0, gold: 0 },
    balance: 100
  });
  state.lastUpdate = 1_000;

  const slotBoost = calculateSlotBoostPerSec(state, RARITIES);
  assert.equal(slotBoost, 0.0135);

  const tick = applyMiningTick(state, RARITIES, 5, 2_000);
  assert.equal(tick.currentBoost, 5.0135);
  assert.equal(state.balance, 100);
  assert.ok(Math.abs(tick.projectedBalance - 105.0135) < 1e-9);
});

test('wallet helpers format and convert values', () => {
  assert.equal(formatWalletLabel(''), 'WALLET');
  assert.equal(formatWalletLabel('EQABCDEF1234567890').startsWith('TON '), true);
  assert.equal(formatWalletAddress('EQABCDEF1234567890').includes('...'), true);
  assert.equal(tonToNanoString(0.05), '50000000');
  assert.equal(formatTonValue(1.5).includes('TON'), true);
  assert.equal(buildTonBalanceEndpoints('EQ_TEST').length, 2);
  assert.equal(buildTonNftEndpoints('EQ_TEST').length, 2);
  assert.equal(normalizeTonAssetUrl('ipfs://abc/hash'), 'https://ipfs.io/ipfs/abc/hash');
});

test('wallet helper normalizes nft payloads', () => {
  const items = normalizeWalletNfts({
    nft_items: [
      {
        address: 'EQ_TEST_1',
        collection: { name: 'Miner Common' },
        metadata: { name: 'Common Dogenance', image: 'ipfs://common/hash' },
        previews: [{ url: 'https://example.com/preview-small.png' }, { url: 'https://example.com/preview-large.png' }]
      },
      {
        address: 'EQ_TEST_2',
        metadata: { name: 'Unknown NFT' }
      }
    ]
  }, RARITIES);

  assert.equal(items.length, 2);
  assert.equal(items[0].rarityId, 'common');
  assert.equal(items[0].image, 'https://example.com/preview-large.png');
  assert.equal(items[1].rarityId, '');
});

test('shop carousel math helpers are deterministic', () => {
  assert.equal(getSignedCarouselOffset(0, 4, 5), 1);
  assert.equal(getSignedCarouselOffset(4, 0, 5), -1);
  assert.equal(getSwipeAxisLock('mouse'), 12);
  assert.equal(getSwipeThreshold('touch'), 24);
});

test('legacy miner inventory helpers return server intents without mutating state', () => {
  const state = normalizeState({
    balance: 120,
    inventory: { common: 2, rare: 0, epic: 0, legendary: 0, gold: 0 },
    activeSlots: { common: 0, rare: 0, epic: 0, legendary: 0, gold: 0 },
    collectedTotals: { common: 2, rare: 0, epic: 0, legendary: 0, gold: 0 }
  });

  const transferOk = transferNftToMatchingSlot(state, 'common', 'common');
  assert.equal(transferOk.ok, false);
  assert.equal(transferOk.reason, 'server_action_required');
  assert.equal(transferOk.intent.action, 'inventory_activate_slot');
  assert.equal(state.inventory.common, 2);
  assert.equal(state.activeSlots.common, 0);

  state.activeSlots.common = 1;
  const removeOk = removeNftFromSlot(state, 'common');
  assert.equal(removeOk.ok, false);
  assert.equal(removeOk.reason, 'server_action_required');
  assert.equal(state.inventory.common, 2);
  assert.equal(state.activeSlots.common, 1);

  const buyOk = buyNftWithMinedBalance(state, RARITIES.find((r) => r.id === 'common'));
  assert.equal(buyOk.ok, false);
  assert.equal(buyOk.reason, 'server_action_required');
  assert.equal(buyOk.intent.action, 'shop_buy');
  assert.equal(state.balance, 120);
  assert.equal(state.inventory.common, 2);
  assert.equal(state.collectedTotals.common, 2);

  const mismatch = transferNftToMatchingSlot(state, 'common', 'rare');
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'mismatch_rarity');
});
