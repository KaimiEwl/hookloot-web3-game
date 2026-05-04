create table if not exists linked_socials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  username text,
  metadata jsonb,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists linked_socials_provider_user_unique
  on linked_socials(provider, provider_user_id);
create unique index if not exists linked_socials_user_provider_unique
  on linked_socials(user_id, provider);
create index if not exists linked_socials_user_id_idx on linked_socials(user_id);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  task_code text not null unique,
  title text not null,
  type text not null,
  reward_units bigint not null default 0,
  is_active boolean not null default true,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_type_idx on tasks(type);
create index if not exists tasks_active_idx on tasks(is_active);

create table if not exists user_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  status text not null default 'pending',
  claimed_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_tasks_status_check check (status in ('pending', 'claimed', 'rejected'))
);

create unique index if not exists user_tasks_user_task_unique on user_tasks(user_id, task_id);
create index if not exists user_tasks_user_id_idx on user_tasks(user_id);

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references users(id) on delete cascade,
  referred_user_id uuid references users(id) on delete cascade,
  referral_code text not null unique,
  status text not null default 'created',
  qualified_at timestamptz,
  rewarded_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referrals_status_check check (status in ('created', 'linked', 'qualified', 'rewarded', 'rejected')),
  constraint referrals_no_self_check check (referred_user_id is null or referred_user_id <> referrer_user_id)
);

create unique index if not exists referrals_referrer_created_unique
  on referrals(referrer_user_id)
  where referred_user_id is null and status = 'created';
create unique index if not exists referrals_referred_user_unique
  on referrals(referred_user_id)
  where referred_user_id is not null;
create index if not exists referrals_referrer_status_idx on referrals(referrer_user_id, status);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  event_type text not null,
  actor_type text,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_user_created_at_idx on audit_logs(user_id, created_at);
create index if not exists audit_logs_event_type_idx on audit_logs(event_type);
