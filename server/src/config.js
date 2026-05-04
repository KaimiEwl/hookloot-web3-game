import 'dotenv/config';
import { z } from 'zod';
import { resolveTonIndexerUrl } from './payments/readiness.js';

function emptyToUndefined(value) {
  return value === '' || value === null || value === undefined ? undefined : value;
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function envBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const configSchema = z.object({
  nodeEnv: z.string().default('development'),
  host: z.string().default('127.0.0.1'),
  port: z.coerce.number().int().positive().default(3101),
  publicAppOrigin: z.string().url(),
  tonProofDomain: z.string().min(1),
  jwtSecret: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  jwtIssuer: z.string().min(1).default('nft-miner-game'),
  jwtAudience: z.string().min(1).default('nft-miner-game-api'),
  sessionTtlSeconds: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  tonProofTtlSeconds: z.coerce.number().int().positive().default(300),
  tonProofMaxAgeSeconds: z.coerce.number().int().positive().default(900),
  miningMaxOfflineSeconds: z.coerce.number().int().positive().default(86400),
  miningPersistIntervalSeconds: z.coerce.number().int().nonnegative().default(30),
  tonNetwork: z.enum(['testnet', 'sandbox', 'mainnet']).default('testnet'),
  tonIndexerUrl: z.string().default(''),
  tonIndexerApiKey: z.string().default(''),
  treasuryWalletAddress: z.string().default(''),
  paymentReceiverWalletAddress: z.string().default(''),
  hotPayoutWalletAddress: z.string().default(''),
  dailyWithdrawalLimitUnits: z.coerce.bigint().default(0n),
  paymentOrderTtlSeconds: z.coerce.number().int().positive().default(900),
  tonPaymentPollIntervalSeconds: z.coerce.number().int().positive().default(15),
  telegramBotToken: z.string().default(''),
  telegramInitDataTtlSeconds: z.coerce.number().int().positive().default(86400),
  telegramRequiredChannelId: z.string().default(''),
  telegramBotApiBaseUrl: z.string().url().default('https://api.telegram.org'),
  referralRewardUnits: z.preprocess(emptyToUndefined, z.coerce.bigint().default(0n)),
  taskRewardUnits: z.preprocess(emptyToUndefined, z.coerce.bigint().default(0n)),
  corsOrigins: z.array(z.string().url()).default([]),
  cookieSecure: z.coerce.boolean().default(true),
  cookieSameSite: z.enum(['strict', 'lax', 'none']).default('lax'),
  rateLimitAuthMax: z.coerce.number().int().positive().default(30),
  rateLimitActionsMax: z.coerce.number().int().positive().default(120),
  metricsEnabled: z.preprocess(envBoolean, z.boolean().default(false)),
  adminPanelEnabled: z.preprocess(envBoolean, z.boolean().default(false)),
  adminBearerToken: z.string().default(''),
  adminWalletAddresses: z.array(z.string()).default([]),
  databaseUrl: z.string().min(1),
  redisUrl: z.string().min(1)
});

export function loadConfig(env = process.env) {
  const parsed = configSchema.parse({
    nodeEnv: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    publicAppOrigin: env.PUBLIC_APP_ORIGIN,
    tonProofDomain: env.TON_PROOF_DOMAIN,
    jwtSecret: env.JWT_SECRET,
    jwtIssuer: env.JWT_ISSUER,
    jwtAudience: env.JWT_AUDIENCE,
    sessionTtlSeconds: env.SESSION_TTL_SECONDS,
    tonProofTtlSeconds: env.TON_PROOF_TTL_SECONDS,
    tonProofMaxAgeSeconds: env.TON_PROOF_MAX_AGE_SECONDS,
    miningMaxOfflineSeconds: env.MINING_MAX_OFFLINE_SECONDS,
    miningPersistIntervalSeconds: env.MINING_PERSIST_INTERVAL_SECONDS,
    tonNetwork: env.TON_NETWORK,
    tonIndexerUrl: env.TON_INDEXER_URL,
    tonIndexerApiKey: env.TON_INDEXER_API_KEY,
    treasuryWalletAddress: env.TREASURY_WALLET_ADDRESS,
    paymentReceiverWalletAddress: env.PAYMENT_RECEIVER_WALLET_ADDRESS,
    hotPayoutWalletAddress: env.HOT_PAYOUT_WALLET_ADDRESS,
    dailyWithdrawalLimitUnits: env.DAILY_WITHDRAWAL_LIMIT_UNITS,
    paymentOrderTtlSeconds: env.PAYMENT_ORDER_TTL_SECONDS,
    tonPaymentPollIntervalSeconds: env.TON_PAYMENT_POLL_INTERVAL_SECONDS,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramInitDataTtlSeconds: env.TELEGRAM_INITDATA_TTL_SECONDS,
    telegramRequiredChannelId: env.TELEGRAM_REQUIRED_CHANNEL_ID,
    telegramBotApiBaseUrl: env.TELEGRAM_BOT_API_BASE_URL,
    referralRewardUnits: env.REFERRAL_REWARD_UNITS,
    taskRewardUnits: env.TASK_REWARD_UNITS,
    corsOrigins: splitCsv(env.CORS_ORIGINS),
    cookieSecure: env.COOKIE_SECURE,
    cookieSameSite: env.COOKIE_SAMESITE,
    rateLimitAuthMax: env.RATE_LIMIT_AUTH_MAX,
    rateLimitActionsMax: env.RATE_LIMIT_ACTIONS_MAX,
    metricsEnabled: env.METRICS_ENABLED,
    adminPanelEnabled: env.ADMIN_PANEL_ENABLED,
    adminBearerToken: env.ADMIN_BEARER_TOKEN,
    adminWalletAddresses: splitCsv(env.ADMIN_WALLET_ADDRESSES),
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL
  });

  if (parsed.tonNetwork === 'mainnet' && !String(parsed.paymentReceiverWalletAddress || '').trim()) {
    throw new Error('PAYMENT_RECEIVER_WALLET_ADDRESS is required when TON_NETWORK=mainnet');
  }

  return {
    ...parsed,
    corsOrigins: parsed.corsOrigins.length ? parsed.corsOrigins : [parsed.publicAppOrigin],
    tonIndexerUrl: resolveTonIndexerUrl({
      network: parsed.tonNetwork,
      url: parsed.tonIndexerUrl
    })
  };
}
