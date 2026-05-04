import { beginCell } from '@ton/ton';
import {
  CATALOG_VERSION,
  NFT_ITEM_ID,
  RARITY_BY_ID,
  RARITY_CATALOG,
  decimalToUnits
} from '../../../shared/domain/catalog.js';

export const TON_NANO_UNIT = 1_000_000_000n;
export const PAYMENT_CATALOG_VERSION = `${CATALOG_VERSION}:payments-v1`;

export const ASSET_TYPES = {
  TON: 'TON',
  JETTON: 'JETTON'
};

export const TON_CHAIN_IDS = {
  mainnet: '-239',
  testnet: '-3',
  sandbox: '-3'
};

const NFT_TON_PRICES = {
  common: '5',
  rare: '10',
  epic: '20',
  legendary: '40',
  gold: '500'
};

export const TON_BOOST_PAYMENT_ITEMS = [
  {
    itemId: 'ton-boost-x2',
    title: 'TON Boost x2',
    tonAmount: '2',
    grant: {
      type: 'ton_boost',
      planId: 'ton-boost-x2',
      multiplier: 2,
      durationSeconds: 24 * 60 * 60
    }
  },
  {
    itemId: 'ton-boost-x5',
    title: 'TON Boost x5',
    tonAmount: '5',
    grant: {
      type: 'ton_boost',
      planId: 'ton-boost-x5',
      multiplier: 5,
      durationSeconds: 24 * 60 * 60
    }
  },
  {
    itemId: 'ton-boost-x10',
    title: 'TON Boost x10',
    tonAmount: '10',
    grant: {
      type: 'ton_boost',
      planId: 'ton-boost-x10',
      multiplier: 10,
      durationSeconds: 24 * 60 * 60
    }
  }
];

export function buildNftPaymentItemId(rarityId) {
  return `${NFT_ITEM_ID}:${rarityId}`;
}

export function tonToNanoUnits(value) {
  return decimalToUnits(value, TON_NANO_UNIT);
}

function buildNftPaymentItems() {
  return RARITY_CATALOG.map((rarity) => ({
    itemId: buildNftPaymentItemId(rarity.id),
    title: `${rarity.name} NFT`,
    tonAmount: NFT_TON_PRICES[rarity.id],
    grant: {
      type: 'nft',
      itemId: NFT_ITEM_ID,
      rarityId: rarity.id,
      quantity: 1
    }
  }));
}

export const PAYMENT_CATALOG_ITEMS = [
  ...buildNftPaymentItems(),
  ...TON_BOOST_PAYMENT_ITEMS
].map((item) => ({
  ...item,
  catalogVersion: PAYMENT_CATALOG_VERSION,
  assetType: ASSET_TYPES.TON,
  jettonContract: null,
  expectedAmountUnits: tonToNanoUnits(item.tonAmount)
}));

export const PAYMENT_ITEM_BY_ID = Object.fromEntries(
  PAYMENT_CATALOG_ITEMS.map((item) => [item.itemId, item])
);

export function getPaymentCatalogItem(itemId) {
  return PAYMENT_ITEM_BY_ID[String(itemId || '')] || null;
}

export function getRarityPaymentItem(rarityId) {
  if (!RARITY_BY_ID[rarityId]) return null;
  return getPaymentCatalogItem(buildNftPaymentItemId(rarityId));
}

export function buildPaymentPayload({ network, orderId }) {
  return `nft-miner:${network || 'testnet'}:${orderId}`;
}

export function buildTonCommentPayload(comment) {
  return beginCell()
    .storeUint(0, 32)
    .storeStringTail(String(comment || ''))
    .endCell()
    .toBoc()
    .toString('base64');
}

export function buildTonConnectTransaction({ order, network }) {
  const chainId = TON_CHAIN_IDS[network || 'testnet'] || TON_CHAIN_IDS.testnet;
  return {
    validUntil: Math.floor(new Date(order.expiresAt).getTime() / 1000),
    network: chainId,
    messages: [
      {
        address: order.receiverWallet,
        amount: BigInt(order.expectedAmountUnits).toString(),
        payload: buildTonCommentPayload(order.payload)
      }
    ]
  };
}
