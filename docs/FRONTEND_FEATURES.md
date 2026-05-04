# Frontend Feature Integration

This page documents the visible frontend flows that sit on top of the server-authoritative API.

## TON Login

- TON Connect remains the main login.
- The client stores only the bearer session token in `sessionStorage`.
- Economy data is loaded from `/api/game/state`; `localStorage` is not used for balance, inventory, boosts, task rewards, or referrals.

## Telegram Linking

- Telegram is only a linked identity for Telegram tasks.
- Inside a Telegram Mini App, the frontend sends raw `window.Telegram.WebApp.initData` to `POST /api/auth/telegram/verify`.
- The frontend never trusts `initDataUnsafe`.
- In a normal browser, the UI shows that Telegram linking is available only from Telegram.
- If `VITE_PUBLIC_TELEGRAM_MINI_APP_URL` or `VITE_PUBLIC_TELEGRAM_BOT_USERNAME` is set, the UI can show an "Open in Telegram" link.

For a normal web Telegram login/linking flow, use Telegram Login Widget with server-side hash verification and BotFather `/setdomain`. Do not verify widget payloads on the client.

## Tasks

- Tasks load from `GET /api/tasks`.
- Claims use `POST /api/tasks/claim` with an `Idempotency-Key`.
- The client sends only the task id.
- Server `readiness` drives the UI states:
  - `ready_to_claim`
  - `claimed`
  - `needs_telegram`
  - `not_configured`
  - `verification_unavailable`
  - `retryable_error`
  - `needs_action`
- Rewards are shown from server values and are not applied locally.

## Referrals

- Referral data loads from `GET /api/referrals/me`.
- The UI supports both `relationships` and older `referrals` response shapes.
- Applying a code uses `POST /api/referrals/apply-code` with an `Idempotency-Key`.
- Self-referral, invalid code, and already-used errors are shown as user-safe messages.

## Payments

- Payment status loads from `GET /api/payments/status`.
- If `configured:false`, the UI shows that TON payments are not configured.
- Sandbox/testnet mode is shown clearly.
- The frontend does not expose receiver secrets and does not issue rewards on TON Connect transaction open.

## Testing

Browser fallback:

```bash
npm run dev
```

Open the app in a normal browser and go to `Tasks`. The Telegram card should explain that linking works from Telegram.

E2E smoke:

```bash
npm run e2e
```

The E2E suite mocks Telegram, tasks, referrals, payment status, and server game state. No real wallet, Telegram token, mainnet payment, or private key is used.

To enable real subscribe-task verification in a deployed environment, configure the backend env values documented in `docs/PRODUCTION_READINESS_CHECKLIST.md`:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_REQUIRED_CHANNEL_ID`
- Telegram bot added to the channel with access to membership checks

