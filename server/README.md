# NFT Miner API Foundation

Fastify API foundation for TON Connect auth. The API is designed to run on the
VPS behind nginx, next to the current frontend.

Production target:

```text
https://demo.example.com
  /      -> existing frontend service on 127.0.0.1:3100
  /api/* -> API service on 127.0.0.1:3101
```

The backend port must stay private. Use `API_HOST=127.0.0.1`; do not bind the
API to `0.0.0.0`.

## Environment

Use `.env.example` as a template only. Real production secrets must live in an
untracked file on the VPS, for example:

```text
/etc/nft-miner-api.env
```

Required values:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `PUBLIC_APP_ORIGIN=https://demo.example.com`
- `TON_PROOF_DOMAIN=demo.example.com`
- `API_HOST=127.0.0.1`
- `API_PORT=3101`
- `MINING_MAX_OFFLINE_SECONDS=86400`
- `MINING_PERSIST_INTERVAL_SECONDS=30`
- `CORS_ORIGINS=https://demo.example.com`
- `RATE_LIMIT_AUTH_MAX=30`
- `RATE_LIMIT_ACTIONS_MAX=120`

## Database

Initial SQL migration:

```text
server/drizzle/0001_foundation.sql
server/drizzle/0002_game_core.sql
server/drizzle/0003_ton_payments.sql
server/drizzle/0004_social_tasks_referrals_hardening.sql
```

Apply migrations with:

```bash
npm run server:migrate
```

The migration runner reads `DATABASE_URL` from the environment and tracks
applied files in `server_migrations`.

## Commands

```bash
npm run server:test
npm run server:build
npm run server:migrate
npm run server:payments:check
npm run server:start
npm run worker:payments
```

## Game API

Authenticated endpoints:

- `GET /api/game/state`
- `POST /api/game/sync`

Both use the shared response envelope and return server-authoritative balance,
inventory, active slots, boosts, and income projection. Client-sent balance or
reward values are rejected by request validation.

## TON Payments

Stage 5 adds server-side order flow:

- `POST /api/payments/orders`
- `GET /api/payments/orders/:id`
- `GET /api/payments/status`
- `POST /api/withdrawals`

`TON_NETWORK` defaults to `testnet`; `sandbox` is also treated as a safe testnet
mode for TON Connect transaction data. Mainnet must be enabled explicitly with
`TON_NETWORK=mainnet`, and config loading fails if mainnet has no
`PAYMENT_RECEIVER_WALLET_ADDRESS`. Opening TON Connect or sending a transaction
from the client does not grant anything. Items/boosts are granted only by
`npm run worker:payments` after it finds and validates an incoming on-chain
transaction against the server-created order payload, receiver, amount and
asset. The withdrawal endpoint creates manual `pending` requests only and does
not sign or broadcast transactions.

The default indexer URL is testnet TonAPI (`https://testnet.tonapi.io/v2`) unless
`TON_INDEXER_URL` is set. `PAYMENT_RECEIVER_WALLET_ADDRESS` must be a wallet you
control; without it `/api/payments/status` reports `configured:false`, payment
order creation returns `payment_receiver_not_configured`, and the payment worker
exits safely. `npm run server:payments:check` prints this status without
revealing secrets. Worker poll logs are structured JSON and checkpoints are not
advanced after indexer failures or unexpected processing errors.

## Telegram Tasks and Referrals

Stage 6 adds Telegram-linked tasks and referrals without making Telegram the
primary login. TON auth remains the main identity. A user can mine and buy
without Telegram. Telegram is required only for Telegram task verification.

Endpoints:

- `POST /api/auth/telegram/verify`
- `GET /api/tasks`
- `POST /api/tasks/claim`
- `GET /api/referrals/me`
- `POST /api/referrals/apply-code`

Telegram task rewards are granted only after server verification:

- `connect_telegram` checks signed Telegram WebApp `initData`.
- `subscribe_channel` checks Telegram Bot API `getChatMember`.
- `invite_friend` uses server referral rows and qualifying actions.
- `own_nft` checks server inventory.

Set these env values on the VPS only:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_REQUIRED_CHANNEL_ID`
- `TELEGRAM_INITDATA_TTL_SECONDS`
- `TELEGRAM_BOT_API_BASE_URL`
- `REFERRAL_REWARD_UNITS`
- `TASK_REWARD_UNITS`

If the bot token or channel id is missing, Telegram-specific rewards fail
safely and no reward is issued. `/api/ready` intentionally does not fail in dev
when Telegram env is empty; `/api/tasks` exposes `not_configured` for the
subscribe task instead. If the bot cannot access the channel, subscribe
verification returns `verification_unavailable`. If Telegram rate-limits or has
a temporary API error, the task returns a retryable verification error.

To configure subscribe checks:

1. Create a bot through BotFather.
2. Add the bot to the required channel.
3. Use a public `@channel` username or Bot API numeric channel id in
   `TELEGRAM_REQUIRED_CHANNEL_ID`.
4. Store the bot token only in the VPS env file.

The server accepts raw Telegram WebApp `initData` only. `initDataUnsafe` is not a
trusted source and raw initData/bot tokens are filtered from audit metadata.

## Production Hardening

The API has rate limit hooks for auth/actions, CORS whitelist from
`CORS_ORIGINS`, security headers, durable idempotency for POST actions, audit
logs, `/api/health`, and `/api/ready`. Do not log or commit real API keys,
Telegram bot tokens, JWT secrets, seed phrases, or private URLs.

## Deployment Docs

See the full VPS checklist here:

```text
docs/deploy-api-vps.md
```
