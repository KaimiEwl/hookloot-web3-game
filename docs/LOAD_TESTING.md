# Load Testing

This project uses `autocannon` for lightweight API load-testing because it runs through npm and fits the existing Node.js toolchain.

The load tests are intentionally safe by default:

- no real payments are created;
- no withdrawals are called;
- protected routes are skipped unless `AUTH_TOKEN` is provided;
- mutating action endpoints are skipped unless `RUN_MUTATIONS=true` is set;
- all tokens and URLs come from environment variables only.

## Scripts

```bash
npm run load:smoke
npm run load:api
```

`load:smoke` defaults to `VUS=1` and `DURATION=5s`.
`load:api` defaults to `VUS=5` and `DURATION=30s`.

Override with env variables:

```bash
BASE_URL=http://127.0.0.1:3101 VUS=2 DURATION=10s npm run load:smoke
```

On Windows PowerShell:

```powershell
$env:BASE_URL = "http://127.0.0.1:3101"
$env:VUS = "2"
$env:DURATION = "10s"
npm run load:smoke
```

## Environment

- `BASE_URL` - API origin, defaults to `http://127.0.0.1:3101`.
- `AUTH_TOKEN` - bearer token for protected endpoints.
- `TEST_USER_ID` - reserved for future user-scoped fixtures if needed.
- `VUS` - concurrent connections.
- `DURATION` - autocannon duration, for example `5s`, `30s`, `2m`.
- `RUN_MUTATIONS=true` - enables the mutating POST action scenario. Use only with disposable staging users.
- `POST_ACTION_ENDPOINT` - action endpoint for the mutating scenario, defaults to `/api/boosts/coin/activate`.
- `POST_ACTION_BODY` - JSON body for the mutating action endpoint, defaults to `{}`.
- `REQUEST_TIMEOUT_SECONDS` - per-request timeout, defaults to `10`.

Never put real secrets in repo files. Set them in shell env, CI secret storage, or a local ignored env wrapper.

## Covered Scenarios

- public `GET /api/health`;
- public `GET /api/ready`;
- public `GET /api/payments/status`;
- authenticated `GET /api/game/state`;
- authenticated `POST /api/game/sync`;
- authenticated `GET /api/tasks`;
- authenticated `GET /api/referrals/me`;
- optional authenticated mutating POST action with `Idempotency-Key`.

The payment scenario checks status only. It does not create TON orders, send transactions, or call withdrawals.

## Local Run

1. Start Postgres and Redis for the API.
2. Start the API on `127.0.0.1:3101`.
3. Run a safe smoke:

```bash
BASE_URL=http://127.0.0.1:3101 npm run load:smoke
```

Protected scenarios need a test bearer token:

```bash
BASE_URL=http://127.0.0.1:3101 AUTH_TOKEN="test-token" npm run load:smoke
```

## Staging Run

Use staging only, not production, unless you have an explicit maintenance window and limits approved.

```bash
BASE_URL=https://demo.example.com AUTH_TOKEN="staging-token" VUS=5 DURATION=30s npm run load:api
```

To include the mutating action scenario, use a disposable test account with enough fake/staging balance:

```bash
BASE_URL=https://demo.example.com `
AUTH_TOKEN="staging-token" `
RUN_MUTATIONS=true `
POST_ACTION_ENDPOINT="/api/boosts/coin/activate" `
POST_ACTION_BODY="{}" `
npm run load:api
```

## Metrics To Watch

From autocannon output:

- latency p50/p95/p99;
- requests/sec average;
- non-2xx counts;
- errors and timeouts;
- status-code distribution.

From the API/ops stack:

- `/api/ready` DB and Redis status;
- `/api/metrics` if enabled;
- process CPU and memory;
- Postgres CPU, locks, slow queries, connection count;
- Redis latency and memory;
- payment worker last run/status if enabled.

## Bad Thresholds

Treat these as warning signs during smoke/staging tests:

- any transport errors or timeouts;
- sustained HTTP 500 responses;
- p95 latency above `500ms` for read endpoints under small smoke load;
- p95 latency above `1000ms` for action endpoints under small staging load;
- `/api/ready` returning unhealthy for DB or Redis;
- payment status endpoint not responding or leaking secret/config details;
- rate limits firing unexpectedly at low VUS;
- ledger/action endpoints producing duplicate effects under retries.

If any threshold trips, stop increasing load and inspect API logs by `request_id` before continuing.
