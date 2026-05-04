const noop = () => {};
const noopAsync = async () => ({ ok: false, reason: 'not_initialized' });

const bridge = {
  wallet: {
    getAddress: () => '',
    getBalanceTon: () => 0,
    getShopReceiverAddress: () => ''
  },
  ui: {
    showToast: noop
  },
  audio: {
    playPurchaseSound: noop
  },
  shop: {
    purchaseWithTon: noopAsync
  }
};

export function registerBridge(nextBridge) {
  if (!nextBridge || typeof nextBridge !== 'object') return;
  Object.keys(nextBridge).forEach((section) => {
    const incoming = nextBridge[section];
    if (!incoming || typeof incoming !== 'object') return;
    bridge[section] = { ...(bridge[section] || {}), ...incoming };
  });
}

export function getBridge() {
  return bridge;
}

export function exposeBridgeOnWindow() {
  // Keep backward compatibility while moving code to structured API.
  window.NFT_MINER_BRIDGE = bridge;
}
