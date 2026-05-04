export const DEFAULT_TON_INDEXER_URLS = {
  testnet: 'https://testnet.tonapi.io/v2',
  sandbox: 'https://testnet.tonapi.io/v2',
  mainnet: 'https://tonapi.io/v2'
};

export function resolveTonIndexerUrl({ network = 'testnet', url = '' } = {}) {
  const explicitUrl = String(url || '').trim();
  if (explicitUrl) return explicitUrl;
  return DEFAULT_TON_INDEXER_URLS[network] || DEFAULT_TON_INDEXER_URLS.testnet;
}

export function getPaymentsRuntimeStatus(config) {
  const receiverWalletConfigured = Boolean(String(config.paymentReceiverWalletAddress || '').trim());
  const indexerConfigured = Boolean(String(config.tonIndexerUrl || '').trim());
  const ready = receiverWalletConfigured && indexerConfigured;

  return {
    configured: ready,
    ready,
    network: config.tonNetwork,
    mode: config.tonNetwork === 'mainnet' ? 'mainnet' : (config.tonNetwork === 'sandbox' ? 'sandbox' : 'testnet'),
    receiverWalletConfigured,
    indexerConfigured,
    workerCanRun: ready,
    orderTtlSeconds: Number(config.paymentOrderTtlSeconds),
    pollIntervalSeconds: Number(config.tonPaymentPollIntervalSeconds),
    mainnetEnabled: config.tonNetwork === 'mainnet'
  };
}
