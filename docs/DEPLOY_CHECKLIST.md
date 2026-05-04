# Deploy Checklist

This checklist is for manual VPS deploy hardening. Do not paste secrets into the
repository and do not edit `/etc` files from Codex unless explicitly requested.

## 1. Backup And Rollback

- Create a backup/archive of the current deployed app directory.
- Snapshot or dump PostgreSQL before applying migrations.
- Record current systemd unit versions and nginx config.
- Confirm rollback command/path before changing anything.

Useful examples:

```bash
tar -czf /opt/backups/nft-miner-$(date +%Y%m%d-%H%M%S).tar.gz /opt/portfolio-demo-app
pg_dump "$DATABASE_URL" > /opt/backups/nft-miner-db-$(date +%Y%m%d-%H%M%S).sql
```

## 2. Env Check

Expected env file path:

```bash
/etc/nft-miner-api.env
```

Required:

- `NODE_ENV=production`
- `API_HOST=127.0.0.1`
- `API_PORT=3101`
- `PUBLIC_APP_ORIGIN=https://demo.example.com`
- `TON_PROOF_DOMAIN=demo.example.com`
- `JWT_SECRET` set and not stored in git
- `DATABASE_URL` set
- `REDIS_URL` set
- `TON_NETWORK=testnet` unless mainnet is explicitly approved
- `METRICS_ENABLED=false` unless protected

Optional/testnet payment:

- `PAYMENT_RECEIVER_WALLET_ADDRESS`
- `TON_INDEXER_URL`
- `TON_INDEXER_API_KEY`

Never commit:

- JWT secrets
- Telegram bot token
- TON API key
- seed phrases/private keys

## 3. Build

```bash
npm ci
npm run server:build
npm run build
```

## 4. Migrations

Run only after DB backup:

```bash
npm run server:migrate
```

## 5. Systemd

Templates:

- `deploy/systemd/nft-miner-api.service.example`
- `deploy/systemd/nft-miner-payments-worker.service.example`

Manual install example:

```bash
sudo cp deploy/systemd/nft-miner-api.service.example /etc/systemd/system/nft-miner-api.service
sudo cp deploy/systemd/nft-miner-payments-worker.service.example /etc/systemd/system/nft-miner-payments-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now nft-miner-api
sudo systemctl enable --now nft-miner-payments-worker
```

Logs:

```bash
journalctl -u nft-miner-api -f
journalctl -u nft-miner-payments-worker -f
```

## 6. Nginx

Use `deploy/nginx.example.conf` as reference only. Keep the existing SSL and
frontend config intact. Add `/api/` proxy to `127.0.0.1:3101`.

Validate manually:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

CORS stays in backend `CORS_ORIGINS`, not wildcard nginx headers.

## 7. Smoke Test

Local from VPS:

```bash
curl -i http://127.0.0.1:3101/api/health
curl -i http://127.0.0.1:3101/api/ready
curl -i http://127.0.0.1:3101/api/payments/status
```

Public through nginx:

```bash
curl -i https://demo.example.com/api/health
curl -i https://demo.example.com/api/ready
curl -i https://demo.example.com/api/payments/status
```

Repo smoke helper:

```bash
SMOKE_BASE_URL=https://demo.example.com npm run smoke:api
```

Expected:

- `/api/health`: `200`
- `/api/ready`: `200` if DB/Redis ready, otherwise `503` with safe reason
- `/api/payments/status`: `200`

## 8. External Port Check

Port `3101` must not be open from the internet.

Manual check from another machine:

```bash
nc -vz demo.example.com 3101
```

Expected: connection refused or timeout.

On VPS:

```bash
ss -ltnp | grep 3101
```

Expected bind: `127.0.0.1:3101`, not `0.0.0.0:3101`.

## 9. Worker Status

```bash
curl -s https://demo.example.com/api/payments/status
```

Check:

- `worker.status`
- `worker.lastRunAt`
- `worker.lastSuccessAt`
- `worker.errorsTotal`

If metrics are enabled behind protection:

```bash
curl -s https://demo.example.com/api/metrics | grep payment_worker
```

## 10. Post-Deploy Watch

Watch for:

- DB down
- Redis down
- payment worker stopped
- high `401`
- high `429`
- high `500`
- too many pending withdrawals
- stuck pending payment orders

See also `docs/OPERATIONS.md`.
