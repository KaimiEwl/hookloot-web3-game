# E2E Smoke Tests

The project uses Playwright for browser smoke coverage of critical UI flows.

Run:

```bash
npm run e2e
```

The Playwright web server command builds the Vite app and serves it locally on `127.0.0.1:4173`.

Covered flows:

- Frontend boot and wallet-connect state for unauthorized users.
- Server-authoritative balance overriding fake `localStorage` economy values.
- Authenticated mocked `/api/game/state` load.
- Shop buy pending state, insufficient balance error, and server-state success update.
- Tasks load, claim error, and claim success update from server state.
- Referral code display, invalid referral error, and self-referral error.
- Payment status UI for testnet/sandbox with receiver-not-configured state.

Safety rules:

- Tests use mocked `/api/*` responses only.
- No real wallets, Telegram tokens, mainnet, or real payments are used.
- POST action mocks require `Idempotency-Key` headers.
