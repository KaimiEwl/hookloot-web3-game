# Operations

This project keeps production observability local-first: structured JSON logs,
health/readiness probes, and optional Prometheus-style metrics. No paid external
service, secret, seed phrase, private key, JWT, Telegram initData, or TON private
payload is required or logged.

## Logs

The API writes one JSON line per request in production:

- `request_id`
- `route`
- `method`
- `status`
- `duration_ms`
- `user_id` when the request authenticated successfully
- `error_code`

Useful commands on a systemd VPS:

```bash
journalctl -u nft-miner-api -f
journalctl -u nft-miner-api --since "1 hour ago"
journalctl -u nft-miner-payments-worker -f
```

Do not log or paste:

- `Authorization` headers
- JWTs
- `Idempotency-Key` values when tied to a real user flow
- Telegram raw `initData`
- TON indexer API keys
- seed phrases or private keys

## Health

Lightweight liveness:

```bash
curl -s https://demo.example.com/api/health
```

Expected: `{ "ok": true, "data": { "status": "ok" }, ... }`.

Readiness:

```bash
curl -s https://demo.example.com/api/ready
```

This checks DB and Redis connectivity and returns safe config status for payments
and metrics without exposing wallet addresses, API keys, or secrets.

## Metrics

Metrics are disabled by default.

```env
METRICS_ENABLED=false
```

Enable only behind trusted network access or Nginx protection:

```env
METRICS_ENABLED=true
```

Then scrape:

```bash
curl -s https://demo.example.com/api/metrics
```

Available basic metrics:

- `http_requests_total`
- `http_request_duration_ms_sum`
- `auth_failures_total`
- `action_failures_total`
- `dependency_ready{dependency="db|redis"}`
- `payment_worker_status`
- `payment_worker_errors_total`
- `payment_worker_last_run_timestamp_seconds`
- `payment_worker_last_success_timestamp_seconds`

## Payment Worker

Run the worker separately from the API:

```bash
npm run worker:payments
```

The worker logs JSON lines for run start/end, retries, credits, ignored
transactions, and failures. It also writes a sanitized runtime status to Redis so
`/api/payments/status` and `/api/metrics` can show whether it is running.

Check payment runtime status:

```bash
curl -s https://demo.example.com/api/payments/status
```

## Alerts To Add

Recommended alerts before mass traffic:

- DB down: `/api/ready` returns non-200 or `dependency_ready{dependency="db"} 0`.
- Redis down: `/api/ready` returns non-200 or `dependency_ready{dependency="redis"} 0`.
- Payment worker stopped: `payment_worker_last_run_timestamp_seconds` is stale.
- Payment worker failing: `payment_worker_errors_total` increases.
- High auth failures: `auth_failures_total` grows unusually fast.
- High rate limits: many `http_requests_total{status="429"}`.
- High server errors: many `http_requests_total{status="500"}`.
- Pending withdrawals too many: query admin read-only withdrawals view.
- Payment order stuck: pending payment orders older than `PAYMENT_ORDER_TTL_SECONDS`.

## Env Summary

Observability env:

```env
METRICS_ENABLED=false
```

Core infra env:

```env
DATABASE_URL=
REDIS_URL=
```

Payment worker env:

```env
TON_NETWORK=testnet
TON_INDEXER_URL=
TON_INDEXER_API_KEY=
PAYMENT_RECEIVER_WALLET_ADDRESS=
TON_PAYMENT_POLL_INTERVAL_SECONDS=15
```

Keep mainnet disabled until explicitly requested and reviewed.
