# AGENTS.md

## Project Stack

- Frontend: Vite app with vanilla JavaScript modules, `@tonconnect/ui`, and `mobile-drag-drop`.
- Backend: Fastify + PostgreSQL + Redis + Drizzle.
- Auth: TON Connect `ton_proof` is the primary login.
- Telegram linking is not a primary login; it is only for Telegram-related tasks.
- Economy is server-authoritative.
- Balance must be stored and calculated only as integer units, never as float.
- All API responses must use the unified envelope:
  `{ ok, data, error, meta }`.

## Hard Rules

- Do not store secrets in code.
- Do not add real private keys, seed phrases, wallet private keys, API tokens, or bot tokens.
- Do not enable mainnet unless explicitly requested.
- Do not grant rewards on the client.
- Do not trust client-provided balance, price, reward, multiplier, wallet ownership, or Telegram `initDataUnsafe`.
- Do not edit production env files that may contain real secrets.

## Required Checks

Run these checks after changes:

```bash
npm run server:test
npm run server:build
npm test
npm run build
```

## Backend Rules

- POST action endpoints must require auth.
- Request body validation must use Zod.
- Mutations must run inside a DB transaction.
- Economy changes must be written to `ledger_events`.
- Security-sensitive events should be written to `audit_logs`.
- Use `Idempotency-Key` for action, payment, and task-claim endpoints where double-submit is possible.
- Payment, economy, task, and referral mutations must remain server-authoritative.

## Frontend Rules

- `localStorage` may only store theme, language, and last opened screen.
- Economy state must come only from the backend.
- Local mining animation is display projection only.
- After any server action response, replace runtime state with the returned server state.
