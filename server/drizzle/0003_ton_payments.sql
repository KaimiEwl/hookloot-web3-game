create table if not exists payment_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  item_id text not null,
  expected_amount_units bigint not null,
  asset_type text not null,
  jetton_contract text,
  receiver_wallet text not null,
  payload text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null,
  idempotency_key text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_orders_status_check check (status in ('pending', 'paid', 'expired', 'cancelled', 'failed')),
  constraint payment_orders_asset_type_check check (asset_type in ('TON', 'JETTON'))
);

create index if not exists payment_orders_user_id_idx on payment_orders(user_id);
create index if not exists payment_orders_status_expires_idx on payment_orders(status, expires_at);
create unique index if not exists payment_orders_user_id_idempotency_key_unique
  on payment_orders(user_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references payment_orders(order_id) on delete restrict,
  user_id uuid not null references users(id) on delete cascade,
  tx_hash text not null unique,
  tx_lt text,
  sender_wallet text,
  receiver_wallet text not null,
  asset_type text not null,
  jetton_contract text,
  amount_units bigint not null,
  payload text not null,
  status text not null,
  raw_tx jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payments_asset_type_check check (asset_type in ('TON', 'JETTON'))
);

create index if not exists payments_order_id_idx on payments(order_id);
create index if not exists payments_user_id_created_at_idx on payments(user_id, created_at);

create table if not exists withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  amount_units bigint not null,
  asset_type text not null,
  destination_wallet text not null,
  status text not null default 'pending',
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint withdrawal_requests_status_check check (status in ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  constraint withdrawal_requests_asset_type_check check (asset_type in ('TON', 'JETTON'))
);

create index if not exists withdrawal_requests_user_id_created_at_idx
  on withdrawal_requests(user_id, created_at);
create index if not exists withdrawal_requests_status_idx on withdrawal_requests(status);

create table if not exists payment_monitor_checkpoints (
  id uuid primary key default gen_random_uuid(),
  network text not null,
  receiver_wallet text not null,
  cursor jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payment_monitor_checkpoints_network_receiver_unique
  on payment_monitor_checkpoints(network, receiver_wallet);
