# Withdrawal Security Notes

Manual withdrawal review is intentionally status-only in this project stage.

Current guarantees:

- no blockchain send transactions are performed by the API;
- no private keys, seed phrases, or hot-wallet signing logic are stored in the repository;
- admin endpoints can move a request through manual review statuses only;
- `paid_external` means an operator marked an external/manual payout as completed outside this app;
- audit logs are written for admin access and manual status changes.

## Statuses

Allowed `withdrawal_requests.status` values:

- `pending` - user created a request and it waits for manual review;
- `under_review` - admin/operator is checking it;
- `approved_manual` - reserved for a future explicit manual approval step;
- `rejected` - admin/operator rejected the request with a reason;
- `cancelled` - reserved for user/admin cancellation flow;
- `paid_external` - admin/operator confirmed an external payout was done manually;
- `failed` - reserved for a failed manual/external operation.

## Balance Reservation Decision Still Needed

Withdrawal balance reservation is not implemented here because doing it incorrectly is riskier than leaving the request as review-only.

Before enabling real withdrawals, choose one model explicitly:

1. Reserve-on-request:
   - subtract or lock withdrawable balance when the user creates a withdrawal request;
   - release reservation on reject/cancel/fail;
   - keep reserved funds separate from available funds.

2. Debit-on-approval:
   - leave balance available until admin approval;
   - re-check balance at approval time;
   - reject if funds are no longer available.

For production finance-like flows, prefer a separate ledger-backed asset balance table with `available_units` and `reserved_units`. Do not use soft mining balance as withdrawable TON unless that product decision is made explicitly.

## What Not To Add Without Explicit Approval

- automatic payouts;
- private key or seed phrase env variables;
- server-side transaction signing;
- mainnet payout worker;
- silent balance debit in admin status changes.
