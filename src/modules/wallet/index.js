export function formatWalletLabel(address) {
  if (!address) return 'WALLET';
  if (address.length < 10) return `TON ${address}`;
  return `TON ${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatWalletAddress(address) {
  if (!address) return '';
  if (address.length < 18) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function formatTonValue(value) {
  return `${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  })} TON`;
}

export function tonToNanoString(value) {
  const normalized = Number(value || 0);
  if (!Number.isFinite(normalized) || normalized <= 0) return '0';
  return String(Math.round(normalized * 1e9));
}

export function buildTonBalanceEndpoints(address) {
  const encoded = encodeURIComponent(address || '');
  return [
    `https://tonapi.io/v2/accounts/${encoded}`,
    `https://toncenter.com/api/v2/getAddressBalance?address=${encoded}`
  ];
}

export function buildTonNftEndpoints(address) {
  const encoded = encodeURIComponent(address || '');
  return [
    `https://tonapi.io/v2/accounts/${encoded}/nfts?limit=24&offset=0&indirect_ownership=true`,
    `https://tonapi.io/v2/accounts/${encoded}/nfts?limit=24&offset=0`
  ];
}

export function normalizeTonAssetUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${raw.slice('ipfs://'.length)}`;
  }
  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }
  return raw;
}

export function getWalletNftItems(payload) {
  if (Array.isArray(payload?.nft_items)) return payload.nft_items;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.nfts)) return payload.nfts;
  return [];
}

export function normalizeWalletNfts(payload, rarities = []) {
  const rarityMatchers = Array.isArray(rarities)
    ? rarities.map((rarity) => ({
      id: rarity.id,
      name: String(rarity.name || rarity.id || ''),
      poster: rarity.poster || ''
    }))
    : [];

  return getWalletNftItems(payload)
    .map((item, index) => {
      const metadata = item?.metadata || {};
      const previews = Array.isArray(item?.previews) ? item.previews : [];
      const lastPreview = previews.length ? previews[previews.length - 1] : null;
      const imageCandidate = lastPreview?.url
        || previews[0]?.url
        || metadata.image
        || metadata.image_url
        || item?.image
        || '';
      const name = String(
        metadata.name
        || item?.name
        || item?.collection?.name
        || item?.collection?.metadata?.name
        || `NFT #${index + 1}`
      ).trim();
      const collectionName = String(
        item?.collection?.name
        || item?.collection?.metadata?.name
        || metadata.collection
        || ''
      ).trim();
      const identity = `${name} ${collectionName}`.toLowerCase();
      const matchedRarity = rarityMatchers.find((rarity) => {
        const rarityName = String(rarity.name || '').toLowerCase();
        return identity.includes(rarity.id) || (rarityName && identity.includes(rarityName));
      });

      return {
        address: String(item?.address || item?.contract?.address || ''),
        name,
        collectionName,
        description: String(metadata.description || item?.description || '').trim(),
        image: normalizeTonAssetUrl(imageCandidate),
        rarityId: matchedRarity?.id || '',
        fallbackPoster: matchedRarity?.poster || '',
        source: item
      };
    })
    .filter((item) => item.name || item.image || item.address);
}
