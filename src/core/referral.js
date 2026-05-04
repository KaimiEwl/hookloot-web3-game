export function getOrCreateReferralCode({ walletAddress = '', storageKey }) {
  void storageKey;
  if (walletAddress) {
    return walletAddress.replace(/[^A-Za-z0-9]/g, '').slice(0, 14) || 'miner';
  }

  return 'miner';
}

export function buildReferralLink(currentHref, code) {
  const url = new URL(currentHref);
  url.searchParams.set('ref', code);
  return url.toString();
}
