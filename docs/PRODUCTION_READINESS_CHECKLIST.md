# Production Readiness Checklist

This checklist must be completed before opening the miner to real users. It is intentionally explicit: server authority, payments, Telegram tasks, admin access and withdrawals all need owner-level decisions before production use.

## 1. Owner Required Values

Owner must provide or decide these values outside the repository. Do not commit real secrets.

- [ ] `TELEGRAM_BOT_TOKEN` is created and stored only in production env/secrets storage.
- [ ] `TELEGRAM_REQUIRED_CHANNEL_ID` is confirmed for the real Telegram channel.
- [ ] `TASK_REWARD_UNITS` is approved in integer units.
- [ ] `REFERRAL_REWARD_UNITS` is approved in integer units.
- [ ] `PAYMENT_RECEIVER_WALLET_ADDRESS` is approved for the selected TON network.
- [ ] `TON_NETWORK` decision is explicit: `testnet` first, `mainnet` only by owner approval.
- [ ] `CORS_ORIGINS` includes only production/staging domains that should call the API.
- [ ] `ADMIN_PANEL_ENABLED` decision is explicit for production.
- [ ] Admin access method selected: `ADMIN_BEARER_TOKEN` or `ADMIN_WALLET_ADDRESSES`.
- [ ] Auth storage decision recorded: current Bearer/JWT session model vs future HttpOnly cookie migration.
- [ ] Withdrawal policy approved: no auto-payout, manual review rules, balance reservation model, limits and operator process.

## 2. Technical Readiness

- [ ] `npm run server:test` passes.
- [ ] `npm run server:build` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run e2e` passes against staging or local preview with mocks.
- [ ] Database migrations are reviewed and applied in staging.
- [ ] Production migration plan is written with exact command and expected output.
- [ ] Backup is created before deploy.
- [ ] Restore test has been performed on a non-production database.
- [ ] Monitoring is enabled for API, DB, Redis, payment worker and host resources.
- [ ] Log rotation is configured if logs are written to files.
- [ ] `journalctl`/service logs are accessible for API and workers.
- [ ] Payment worker service is installed, enabled and restart-on-failure is configured.
- [ ] Admin panel is disabled by default or restricted to approved admin credentials/wallets.
- [ ] Load smoke test plan is ready and uses staging-safe limits.
- [ ] Security review completed for auth, idempotency, server-authoritative economy, payments, Telegram tasks and admin endpoints.
- [ ] External port check confirms backend-only ports are not exposed publicly.

## 3. Payment Readiness

- [ ] `TON_NETWORK=testnet` is used for first staged payment tests.
- [ ] Testnet receiver wallet is configured in env, not committed.
- [ ] `/api/payments/status` shows configured testnet status without leaking secrets.
- [ ] A testnet payment order can be created.
- [ ] A real testnet transaction is detected by the worker.
- [ ] Reward/item is credited only after confirmed on-chain transaction.
- [ ] Duplicate transaction test passes: same `tx_hash` cannot credit twice.
- [ ] Duplicate order test passes: paid order cannot credit twice.
- [ ] Wrong amount test passes: payment is ignored/rejected and no reward is issued.
- [ ] Wrong receiver test passes: payment is ignored/rejected and no reward is issued.
- [ ] Wrong payload/comment test passes: payment is ignored/rejected and no reward is issued.
- [ ] Worker restart test passes: checkpoint resumes safely and does not rescan/credit old tx twice.
- [ ] `mainnet` remains disabled until explicit owner switch and final testnet sign-off.

## 4. Telegram Readiness

- [ ] Telegram bot token is created and stored only in production env/secrets storage.
- [ ] Bot is added to the required channel.
- [ ] Bot has the access needed for `getChatMember` checks.
- [ ] `TELEGRAM_REQUIRED_CHANNEL_ID` or channel username is verified against the real channel.
- [ ] Telegram WebApp `initData` verification works in staging.
- [ ] Expired or invalid `initData` is rejected.
- [ ] `initDataUnsafe` is not trusted by backend logic.
- [ ] Subscribe task is verified with a real subscribed test user.
- [ ] Subscribe task is rejected for a non-member test user.
- [ ] Telegram API unavailable/rate-limited case returns a retryable/clear error without granting reward.

## 5. Release Steps

- [ ] Announce maintenance/deploy window if needed.
- [ ] Create database backup.
- [ ] Create app/server file backup or tag the release commit.
- [ ] Verify rollback target is available.
- [ ] Deploy backend code to VPS.
- [ ] Deploy frontend build to VPS.
- [ ] Install/update dependencies.
- [ ] Run migrations.
- [ ] Restart API service.
- [ ] Restart frontend service if separate.
- [ ] Restart payment worker service.
- [ ] Check API service status.
- [ ] Check payment worker service status.
- [ ] Run `curl https://demo.example.com/api/health` or production equivalent.
- [ ] Run `curl https://demo.example.com/api/ready` or production equivalent.
- [ ] Run `curl https://demo.example.com/api/payments/status` or production equivalent.
- [ ] Run frontend smoke test in browser/mobile viewport.
- [ ] Run E2E smoke on staging/production-safe mode.
- [ ] Check logs for 401/429/500 spikes.
- [ ] Confirm rollback plan can be executed quickly if smoke fails.

## 6. Go / No-Go Criteria

### Must Be Green Before Real Users

- [ ] Server-authoritative economy is active: client cannot set balance, inventory, boosts or rewards.
- [ ] All critical tests pass: server tests, frontend tests, build, E2E smoke.
- [ ] Migrations applied cleanly in staging and production plan is reviewed.
- [ ] Backup and restore process has been tested.
- [ ] TON payments are proven on testnet, including wrong amount/payload/receiver and duplicate tx cases.
- [ ] Payment worker restart/checkpoint behavior is verified.
- [ ] Telegram linking and subscribe verification are proven with real Telegram WebApp/channel setup.
- [ ] Admin access is restricted and audited.
- [ ] Withdrawal flow is manual-only with no private keys and no auto-payout.
- [ ] Monitoring/logging is sufficient to investigate incidents by request id.
- [ ] Backend internal ports are not publicly exposed.
- [ ] No real secrets are committed to repository files.

### Can Remain TODO For Initial Controlled Launch

- [ ] Automatic withdrawals/payouts. Keep disabled.
- [ ] HttpOnly cookie auth migration, if Bearer remains accepted as an explicit temporary decision.
- [ ] Advanced admin write tools beyond withdrawal manual status management.
- [ ] Full production load/soak test, if initial launch is limited and smoke/load foundation is ready.
- [ ] Advanced analytics dashboards.
- [ ] On-chain NFT ownership task, if internal inventory ownership is enough for the first release.
- [ ] Mainnet switch, until testnet payment flow is fully signed off.

If any must-be-green item is red, the release is `NO-GO` for real users.
