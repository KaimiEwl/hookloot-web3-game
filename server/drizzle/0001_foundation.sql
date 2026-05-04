create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  address text not null,
  raw_address text not null,
  network text not null default 'mainnet',
  public_key text not null,
  is_primary boolean not null default true,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists wallets_address_unique on wallets(address);
create index if not exists wallets_user_id_idx on wallets(user_id);

create table if not exists sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  wallet_id uuid not null references wallets(id) on delete cascade,
  token_hash text not null,
  user_agent text,
  ip_hash text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists sessions_token_hash_unique on sessions(token_hash);
create index if not exists sessions_user_id_idx on sessions(user_id);
create index if not exists sessions_live_idx on sessions(user_id) where revoked_at is null;

create table if not exists auth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  wallet_address text,
  type text not null,
  ok boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists auth_events_wallet_idx on auth_events(wallet_address);
create index if not exists auth_events_type_idx on auth_events(type);

create table if not exists idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  scope text not null,
  route text not null,
  key text not null,
  request_hash text not null,
  response jsonb,
  status text not null default 'started',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idempotency_keys_scope_route_key_unique
  on idempotency_keys(scope, route, key);
create index if not exists idempotency_keys_user_id_idx on idempotency_keys(user_id);
create index if not exists idempotency_keys_expires_at_idx on idempotency_keys(expires_at);
