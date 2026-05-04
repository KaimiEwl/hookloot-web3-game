-- DB hardening pass for server-authoritative economy, payments and auth.
-- This migration is additive: it does not rewrite existing migrations or business values.

create unique index if not exists wallets_address_lower_unique
  on wallets ((lower(address)));
create unique index if not exists wallets_raw_address_unique on wallets(raw_address);

create unique index if not exists payment_orders_order_id_unique on payment_orders(order_id);
create unique index if not exists payments_tx_hash_unique on payments(tx_hash);

create index if not exists sessions_expires_at_idx on sessions(expires_at);
create index if not exists sessions_revoked_at_idx on sessions(revoked_at);

create index if not exists auth_events_user_created_at_idx on auth_events(user_id, created_at);
create index if not exists auth_events_type_created_at_idx on auth_events(type, created_at);

create unique index if not exists idempotency_keys_user_scope_key_unique
  on idempotency_keys(user_id, scope, key)
  where user_id is not null;

create unique index if not exists active_slots_inventory_id_unique on active_slots(inventory_id);

create index if not exists payment_orders_user_status_expires_idx
  on payment_orders(user_id, status, expires_at);

create index if not exists payments_order_id_created_at_idx on payments(order_id, created_at);

create index if not exists withdrawal_requests_status_created_at_idx
  on withdrawal_requests(status, created_at);

create index if not exists payment_monitor_checkpoints_updated_at_idx
  on payment_monitor_checkpoints(updated_at);

create index if not exists referrals_referrer_user_id_idx on referrals(referrer_user_id);

create index if not exists audit_logs_user_event_type_created_at_idx
  on audit_logs(user_id, event_type, created_at);
create index if not exists audit_logs_actor_type_event_type_created_at_idx
  on audit_logs(actor_type, event_type, created_at);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'game_accounts_balance_non_negative_check') then
    alter table game_accounts
      add constraint game_accounts_balance_non_negative_check check (balance_units >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventories_quantity_non_negative_check') then
    alter table inventories
      add constraint inventories_quantity_non_negative_check check (quantity >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'boost_states_level_non_negative_check') then
    alter table boost_states
      add constraint boost_states_level_non_negative_check check (level >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payment_orders_expected_amount_positive_check') then
    alter table payment_orders
      add constraint payment_orders_expected_amount_positive_check check (expected_amount_units > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payments_amount_positive_check') then
    alter table payments
      add constraint payments_amount_positive_check check (amount_units > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'withdrawal_requests_amount_positive_check') then
    alter table withdrawal_requests
      add constraint withdrawal_requests_amount_positive_check check (amount_units > 0);
  end if;
end $$;
