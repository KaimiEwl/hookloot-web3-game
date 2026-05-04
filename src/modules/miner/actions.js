export function transferNftToMatchingSlot(state, sourceRarityId, targetRarityId) {
  if (!state || !sourceRarityId || !targetRarityId) return { ok: false, reason: 'invalid_input' };
  if (sourceRarityId !== targetRarityId) return { ok: false, reason: 'mismatch_rarity' };

  const available = Number(state.inventory?.[sourceRarityId] || 0);
  if (available <= 0) return { ok: false, reason: 'empty_inventory' };

  return {
    ok: false,
    reason: 'server_action_required',
    intent: { action: 'inventory_activate_slot', rarityId: targetRarityId }
  };
}

export function removeNftFromSlot(state, rarityId) {
  if (!state || !rarityId) return { ok: false, reason: 'invalid_input' };

  const activeCount = Number(state.activeSlots?.[rarityId] || 0);
  if (activeCount <= 0) return { ok: false, reason: 'empty_slot' };

  return {
    ok: false,
    reason: 'server_action_required',
    intent: { action: 'inventory_remove_slot', rarityId }
  };
}

export function buyNftWithMinedBalance(state, rarity) {
  if (!state || !rarity || !rarity.id) return { ok: false, reason: 'invalid_input' };

  const cost = Number(rarity.cost || 0);
  if (!Number.isFinite(cost) || cost <= 0) return { ok: false, reason: 'invalid_cost' };

  const balance = Number(state.balance || 0);
  if (balance < cost) return { ok: false, reason: 'insufficient_balance' };

  return {
    ok: false,
    reason: 'server_action_required',
    intent: { action: 'shop_buy', rarityId: rarity.id }
  };
}
