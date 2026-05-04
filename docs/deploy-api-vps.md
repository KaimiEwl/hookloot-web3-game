# Deploy API Foundation on VPS

This is a deploy-preparation guide for the Stage 1 API foundation. It does not
replace the existing frontend service on `127.0.0.1:3100`.

## Target Layout

```text
https://demo.example.com
  /      -> frontend on http://127.0.0.1:3100
  /api/* -> Fastify API on http://127.0.0.1:3101
```

Security rule: the API must bind only to `127.0.0.1:3101`. Do not open `3101`
in the firewall and do not bind it to `0.0.0.0`.

## VPS Prerequisites

- Node.js 20+ or current LTS.
- PostgreSQL.
- Redis.
- Existing nginx SSL server block for `demo.example.com`.
- Project checkout, for example `/opt/nft-miner-game`.

## PostgreSQL

Create a dedicated database/user with a strong password on the VPS:

```bash
sudo -u postgres psql
```

```sql
create user nft_miner with password '<strong-db-password>';
create database nft_miner owner nft_miner;
grant all privileges on database nft_miner to nft_miner;
\q
```

Do not commit the real password. Store it only in the production env file.

## Redis

Use a local Redis instance. If Redis requires a password, put it only in
`/etc/nft-miner-api.env` as part of `REDIS_URL`.

Example local URLs:

```text
REDIS_URL=redis://127.0.0.1:6379/0
REDIS_URL=redis://:<redis-password>@127.0.0.1:6379/0
```

## Production Env File

Create an untracked env file on the VPS:

```bash
sudo install -o root -g nftminer -m 0640 /dev/null /etc/nft-miner-api.env
sudo nano /etc/nft-miner-api.env
```

Example values, replace placeholders:

```text
API_HOST=127.0.0.1
API_PORT=3101
PUBLIC_APP_ORIGIN=https://demo.example.com
TON_PROOF_DOMAIN=demo.example.com
JWT_SECRET=<long-random-secret-at-least-32-chars>
JWT_ISSUER=nft-miner-game
JWT_AUDIENCE=nft-miner-game-api
SESSION_TTL_SECONDS=2592000
TON_PROOF_TTL_SECONDS=300
TON_PROOF_MAX_AGE_SECONDS=900
MINING_MAX_OFFLINE_SECONDS=86400
MINING_PERSIST_INTERVAL_SECONDS=30
CORS_ORIGINS=https://demo.example.com
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
RATE_LIMIT_AUTH_MAX=30
RATE_LIMIT_ACTIONS_MAX=120
DATABASE_URL=postgres://nft_miner:<strong-db-password>@127.0.0.1:5432/nft_miner
REDIS_URL=redis://127.0.0.1:6379/0

# Stage 5 payment order flow. Keep testnet/sandbox until mainnet is deliberately enabled.
TON_NETWORK=testnet
TON_INDEXER_URL=https://testnet.tonapi.io/v2
TON_INDEXER_API_KEY=<optional-indexer-key>
TREASURY_WALLET_ADDRESS=<cold-or-treasury-wallet>
PAYMENT_RECEIVER_WALLET_ADDRESS=<receiver-wallet-for-incoming-orders>
HOT_PAYOUT_WALLET_ADDRESS=<manual-payout-hot-wallet>
DAILY_WITHDRAWAL_LIMIT_UNITS=0
PAYMENT_ORDER_TTL_SECONDS=900
TON_PAYMENT_POLL_INTERVAL_SECONDS=15

# Stage 6 Telegram tasks and referrals. Leave empty until the Telegram bot is ready.
TELEGRAM_BOT_TOKEN=
TELEGRAM_INITDATA_TTL_SECONDS=86400
TELEGRAM_REQUIRED_CHANNEL_ID=
TELEGRAM_BOT_API_BASE_URL=https://api.telegram.org
REFERRAL_REWARD_UNITS=0
TASK_REWARD_UNITS=0
```

Keep `API_HOST=127.0.0.1`.

## Install App Dependencies

From the project directory on the VPS:

```bash
cd /opt/nft-miner-game
npm ci
```

## Migrations

Run migrations from the project directory with the production env loaded:

```bash
cd /opt/nft-miner-game
set -a
. /etc/nft-miner-api.env
set +a
npm run server:migrate
```

The migration runner applies files from `server/drizzle/*.sql` and records them
in `server_migrations`. The existing `server/drizzle/0001_foundation.sql` should
not be edited after it has been applied to production.

## Payment Worker

Stage 5 adds a separate monitor worker:

```bash
cd /opt/nft-miner-game
set -a
. /etc/nft-miner-api.env
set +a
npm run worker:payments
```

Run it under a separate systemd service in production. Example:

```text
deploy/systemd/nft-miner-payments-worker.service.example
```

The worker must use the same env file as the API. It only reads incoming
transactions from the TON indexer and credits orders after validating
`receiver_wallet`, amount, payload, asset type and linked sender wallet. It does
not store private keys and does not make automatic payouts.

Safe setup:

- Leave `TON_NETWORK=testnet` or `TON_NETWORK=sandbox` while testing.
- Set `PAYMENT_RECEIVER_WALLET_ADDRESS` only to a testnet/sandbox wallet you
  control.
- If `PAYMENT_RECEIVER_WALLET_ADDRESS` is empty, `/api/payments/status` returns
  `configured:false`, payment order creation fails with
  `payment_receiver_not_configured`, and the worker exits without scanning.
- `TON_NETWORK=mainnet` fails fast unless `PAYMENT_RECEIVER_WALLET_ADDRESS` is
  configured. Do not switch to mainnet until explicitly approved.

Start/check commands:

```bash
npm run server:payments:check
npm run worker:payments -- --once
sudo systemctl start nft-miner-payments-worker
sudo journalctl -u nft-miner-payments-worker -f
```

Worker logs are structured JSON and include a `runId` for each poll. Checkpoint
state is stored in Postgres; it is not advanced when the indexer fails or when
transaction processing hits an unexpected error.

Readiness checks:

```bash
npm run server:payments:check
curl https://demo.example.com/api/payments/status
```

If `PAYMENT_RECEIVER_WALLET_ADDRESS` is empty, the worker exits cleanly and no
payment orders can be created. Do not use a wallet address unless you control
its keys.

## systemd

Use the example service:

```text
deploy/systemd/nft-miner-api.service.example
```

Install it:

```bash
sudo cp deploy/systemd/nft-miner-api.service.example /etc/systemd/system/nft-miner-api.service
sudo systemctl daemon-reload
sudo systemctl enable nft-miner-api
sudo systemctl start nft-miner-api
sudo systemctl status nft-miner-api --no-pager
```

Check that it listens locally only:

```bash
ss -ltnp | grep 3101
```

Expected bind:

```text
127.0.0.1:3101
```

## nginx

Use the snippet:

```text
deploy/nginx/demo.example.com.api.conf.example
```

Add the `location /api/` block inside the existing SSL `server` block for
`demo.example.com`. Do not replace the frontend proxy/root for `/`.

Then validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Healthcheck

Local API check on the VPS:

```bash
curl -s http://127.0.0.1:3101/api/health
```

Public check through nginx:

```bash
curl -s https://demo.example.com/api/health
```

Readiness check with DB/Redis:

```bash
curl -s https://demo.example.com/api/ready
```

Expected envelope shape:

```json
{
  "ok": true,
  "data": {
    "status": "ok"
  },
  "error": null,
  "meta": {
    "requestId": "...",
    "serverTime": "..."
  }
}
```

## Telegram Tasks and Referrals

Telegram is not the primary login. Users authenticate with TON and can mine or
shop without linking Telegram. Telegram linking is required only for
Telegram-specific tasks.

Required VPS-only env values for Telegram tasks:

```text
TELEGRAM_BOT_TOKEN=<bot-token-from-botfather>
TELEGRAM_REQUIRED_CHANNEL_ID=<channel-id-or-@username>
```

How to configure safely:

1. Create a bot with BotFather in Telegram and copy the bot token into the VPS
   env file only. Do not commit it.
2. Add the bot to the required Telegram channel.
3. For private channels or strict verification, promote the bot enough that
   `getChatMember` works for the channel.
4. Set `TELEGRAM_REQUIRED_CHANNEL_ID` to either the public `@channel` username
   or the numeric channel id used by the Bot API.
5. Restart the API after changing the env file.

The bot must be able to call `getChatMember` for the configured channel. If the
Telegram env is missing, `/api/ready` still works for dev, while `/api/tasks`
marks the subscribe task readiness as `not_configured`. If Telegram returns a
rate limit or provider error, the task returns a retryable verification error and
does not issue rewards. If the bot lacks channel access/admin visibility, the
task returns `verification_unavailable`.

The API accepts only raw `window.Telegram.WebApp.initData` for linking. It does
not trust `initDataUnsafe` and audit logs do not store raw initData or bot
tokens.

Referrals are server-generated. Rewards are written through `ledger_events` and
are idempotent.

## Hardening Notes

- Keep `CORS_ORIGINS` restricted to trusted origins.
- Keep `API_HOST=127.0.0.1`; never expose `3101` publicly.
- Keep secrets in `/etc/nft-miner-api.env`, not in git.
- Do not log raw Telegram `initData`, JWTs, TON API keys, seed phrases, or
  private keys.
- POST actions use `Idempotency-Key`; clients should reuse the same key only
  for the same retry.

## Rollback

If the API fails, keep the frontend running and remove only the API route:

```bash
sudo systemctl stop nft-miner-api
```

Then remove or comment only the nginx `location /api/` block and reload nginx.
Do not change the existing frontend service on `127.0.0.1:3100`.
