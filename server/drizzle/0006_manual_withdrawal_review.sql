-- Manual withdrawal review status hardening.
-- This is status management only: no blockchain transactions, no private keys, no auto-payout.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'withdrawal_requests_status_allowed_check') then
    alter table withdrawal_requests
      add constraint withdrawal_requests_status_allowed_check
      check (status in (
        'pending',
        'under_review',
        'approved_manual',
        'rejected',
        'cancelled',
        'paid_external',
        'failed'
      ));
  end if;
end $$;

create index if not exists withdrawal_requests_user_status_created_at_idx
  on withdrawal_requests(user_id, status, created_at);
