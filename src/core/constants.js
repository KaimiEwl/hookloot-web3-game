export const RARITIES = [
  { id: 'common', name: 'Common', boost: 0.003, cost: 5, tonCost: 5, video: '/nft-videos/common.mp4', slotVideo: '/nft-videos-slots/common.mp4', poster: '/nft-icons/common.webp' },
  { id: 'rare', name: 'Rare', boost: 0.0075, cost: 10, tonCost: 10, video: '/nft-videos/rare.mp4', slotVideo: '/nft-videos-slots/rare.mp4', poster: '/nft-icons/rare.webp' },
  { id: 'epic', name: 'Epic', boost: 0.018, cost: 20, tonCost: 20, video: '/nft-videos/epic.mp4', slotVideo: '/nft-videos-slots/epic.mp4', poster: '/nft-icons/epic.webp' },
  { id: 'legendary', name: 'Legendary', boost: 0.045, cost: 40, tonCost: 40, video: '/nft-videos/legendary.mp4', slotVideo: '/nft-videos-slots/legendary.mp4', poster: '/nft-icons/legendary.webp' },
  { id: 'gold', name: 'Gold', boost: 0, incomeMultiplier: 5, cost: 500, tonCost: 500, video: '/nft-videos/gold.mp4', slotVideo: '/nft-videos-slots/gold.mp4', poster: '/nft-icons/gold.webp' }
];

export const BOOST_QUESTS = [
  { id: 'boost-common-x10', rarityId: 'common', target: 10, rewardPerSec: 0.004 },
  { id: 'boost-rare-x10', rarityId: 'rare', target: 10, rewardPerSec: 0.008 },
  { id: 'boost-epic-x10', rarityId: 'epic', target: 10, rewardPerSec: 0.016 },
  { id: 'boost-legendary-x10', rarityId: 'legendary', target: 10, rewardPerSec: 0.032 },
  { id: 'boost-gold-x1', rarityId: 'gold', target: 1, rewardPerSec: 0.18 }
];

export const TON_BOOST_PLANS = [
  { id: 'ton-boost-x2', multiplier: 2, tonCost: 2, durationHours: 24 },
  { id: 'ton-boost-x5', multiplier: 5, tonCost: 5, durationHours: 24 },
  { id: 'ton-boost-x10', multiplier: 10, tonCost: 10, durationHours: 24 }
];

const COIN_BOOST_COSTS = [100, 150, 220, 320, 460, 660, 940, 1340, 1900, 2700];
const COIN_BOOST_REWARDS = [0.0007, 0.0009, 0.0011, 0.0014, 0.0018, 0.0022, 0.0027, 0.0033, 0.0040, 0.0048];

export const COIN_BOOST_LEVELS = COIN_BOOST_COSTS.map((cost, index) => ({
  id: `coin-boost-${index + 1}`,
  level: index + 1,
  cost,
  rewardPerSec: COIN_BOOST_REWARDS[index]
}));

export const DEFAULT_ACCENTS = {
  common: [46, 139, 87],
  rare: [70, 130, 180],
  epic: [138, 43, 226],
  legendary: [242, 138, 31],
  gold: [212, 175, 55]
};

export const RARITY_COLORS = {
  common: '#2E8B57',
  rare: '#4682B4',
  epic: '#8A2BE2',
  legendary: '#F28A1F',
  gold: '#D4AF37'
};

export const STORAGE_KEYS = {
  STATE: 'nftMinerState',
  SCREEN: 'nftMinerLastScreen',
  TON_WALLET: 'tonWalletAddress',
  REFERRAL_CODE: 'nftMinerReferralCode',
  SHOP_RECEIVER: 'shopTonReceiverAddress',
  THEME: 'theme',
  LANGUAGE: 'language'
};

export const APP_SCREENS = {
  MINER: 'miner',
  TASKS: 'tasks',
  BOOST: 'boost',
  SHOP: 'shop',
  WALLET: 'wallet',
  ADMIN: 'admin'
};

export const APP_EVENTS = {
  TON_BALANCE_CHANGED: 'ton-balance-changed',
  TON_WALLET_CHANGED: 'ton-wallet-changed',
  SCREEN_CHANGED: 'app-screen-changed'
};

export const TON_BALANCE_REFRESH_MS = 15000;
