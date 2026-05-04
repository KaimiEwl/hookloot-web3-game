create table if not exists game_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  balance_units bigint not null default 0,
  last_mined_at timestamptz not null default now(),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists game_accounts_user_id_unique on game_accounts(user_id);
create index if not exists game_accounts_user_id_idx on game_accounts(user_id);

create table if not exists inventories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  item_id text not null,
  rarity_id text,
  quantity integer not null default 0,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventories_user_item_rarity_unique
  on inventories(user_id, item_id, coalesce(rarity_id, ''));
create index if not exists inventories_user_item_idx on inventories(user_id, item_id);
create index if not exists inventories_user_id_idx on inventories(user_id);

create table if not exists active_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  slot_index integer not null,
  inventory_id uuid not null references inventories(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists active_slots_user_slot_index_unique
  on active_slots(user_id, slot_index);
create index if not exists active_slots_user_slot_index_idx
  on active_slots(user_id, slot_index);
create index if not exists active_slots_inventory_id_idx on active_slots(inventory_id);

create table if not exists boost_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  boost_type text not null,
  level integer not null default 0,
  active_until timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists boost_states_user_boost_type_unique
  on boost_states(user_id, boost_type);
create index if not exists boost_states_user_boost_type_idx
  on boost_states(user_id, boost_type);

create table if not exists ledger_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_type text not null,
  amount_delta bigint not null default 0,
  balance_before bigint,
  balance_after bigint,
  source text,
  source_id text,
  idempotency_key text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ledger_events_user_created_at_idx
  on ledger_events(user_id, created_at);
create index if not exists ledger_events_source_source_id_idx
  on ledger_events(source, source_id)
  where source_id is not null;
