-- 03-data-model §1 (entities, people, staff) and §5 (account, billing, flags, notices, audit, job).
-- Conventions: uuid keys, created_at and updated_at everywhere, money as bigint centavos (_cents),
-- percentages as numeric(7,4) fractions, status columns as enums.

-- Enums ------------------------------------------------------------------------------------------

create type public.channel as enum ('ifood', 'food99', 'keeta', 'rappi');
create type public.store_source as enum ('public', 'api', 'file', 'extension', 'manual');
create type public.member_role as enum ('dono', 'financeiro', 'gerente');
create type public.contact_channel as enum ('email', 'whatsapp');
create type public.staff_role as enum ('fundador', 'operacao');
create type public.billing_unit as enum ('kitchen', 'channel_store');
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'canceled', 'free');
create type public.flag_env as enum ('sandbox', 'production');
create type public.notification_channel as enum ('email', 'whatsapp', 'whatsapp_manual');
create type public.notification_status as enum ('queued', 'sent', 'failed', 'held_quiet_hours');
create type public.alert_severity as enum ('urgente', 'medio', 'baixo');
create type public.actor_kind as enum ('person', 'staff', 'system');
create type public.job_status as enum ('queued', 'running', 'done', 'failed');

-- §5 Plans come first: account.plan_id references them ------------------------------------------

create table public.plan (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price_cents bigint check (price_cents >= 0),
  billing_unit public.billing_unit not null default 'kitchen',
  trial_days int not null default 14 check (trial_days >= 0),
  features jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.plan is 'Prices and trial are data, edited in C15 (D40). price_cents null: by conversation.';

-- §1 Entities (D29) ------------------------------------------------------------------------------

create table public.account (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  plan_id uuid references public.plan (id),
  trial_ends_at timestamptz,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.account is 'Conta: the group that pays. code (e.g. G-02) is shown in the console.';

create table public.company (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  cnpj text not null check (cnpj ~ '^\d{14}$'),
  legal_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, cnpj),
  unique (account_id, id)
);
comment on table public.company is 'Empresa: a CNPJ (digits only) inside a conta. Invoices attach here.';

create table public.kitchen (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  company_id uuid not null,
  name text not null,
  address text,
  city text,
  uf char(2),
  lat numeric(9, 6),
  lng numeric(9, 6),
  in_analysis boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, company_id) references public.company (account_id, id) on delete cascade
);
comment on column public.kitchen.in_analysis is 'Drives billing: units_billed counts kitchens in analysis (D28, D40).';

create table public.brand (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

create table public.channel_store (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  kitchen_id uuid,
  brand_id uuid,
  channel public.channel not null,
  external_id text not null,
  name text not null,
  corporate_name text,
  public_url text,
  listed boolean not null default true,
  authorized boolean not null default false,
  authorized_at timestamptz,
  source public.store_source not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_id),
  foreign key (account_id, kitchen_id) references public.kitchen (account_id, id) on delete set null (kitchen_id),
  foreign key (account_id, brand_id) references public.brand (account_id, id) on delete set null (brand_id)
);
comment on table public.channel_store is 'Loja de canal: one brand at one kitchen on one app. kitchen_id null means "sem cozinha" (D29).';

create table public.channel_store_url_history (
  id uuid primary key default gen_random_uuid(),
  channel_store_id uuid not null references public.channel_store (id) on delete cascade,
  url text not null,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_store_id, url)
);

-- §1 People ----------------------------------------------------------------------------------------

create table public.person (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name text not null,
  email text,
  whatsapp_e164 text check (whatsapp_e164 ~ '^\+[1-9]\d{7,14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index person_email_key on public.person (lower(email)) where email is not null;
create unique index person_whatsapp_key on public.person (whatsapp_e164) where whatsapp_e164 is not null;

create table public.membership (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  person_id uuid not null references public.person (id) on delete cascade,
  role public.member_role not null,
  all_kitchens boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, person_id)
);

create table public.membership_kitchen (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.membership (id) on delete cascade,
  kitchen_id uuid not null references public.kitchen (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, kitchen_id)
);

create table public.invite (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  role public.member_role not null,
  kitchen_ids uuid[] not null default '{}',
  channel public.contact_channel not null,
  destination text not null,
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  invited_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.person (id) on delete cascade,
  role public.staff_role not null,
  invited_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.session_device (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person (id) on delete cascade,
  user_agent text,
  ip_city text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.security_lock (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  reason text not null,
  until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.security_lock is '24-hour lock on plan and people changes after a contact change (D35).';

create table public.owner_authorization (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  company_id uuid not null,
  scope text[] not null default '{}',
  includes_ai boolean not null default false,
  includes_international boolean not null default false,
  signed_by uuid references public.person (id) on delete set null,
  signed_at timestamptz not null,
  document_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, company_id) references public.company (account_id, id) on delete cascade
);
comment on table public.owner_authorization is 'No real file is processed for a CNPJ without one (C14, D21).';

-- §5 Billing --------------------------------------------------------------------------------------

create table public.subscription (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.account (id) on delete cascade,
  plan_id uuid not null references public.plan (id),
  status public.subscription_status not null,
  asaas_customer_id text,
  asaas_subscription_id text,
  next_due_on date,
  units_billed int not null default 0 check (units_billed >= 0),
  last_event text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.subscription is 'Status changes only from Asaas webhooks (D27).';

create table public.billing_event (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.account (id) on delete cascade,
  asaas_event text not null,
  asaas_event_id text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.billing_event is 'Raw Asaas webhooks, idempotent by asaas_event_id. account_id null until the customer is matched.';

create table public.pilot (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.account (id) on delete cascade,
  pct_months_1_2 numeric(7, 4) check (pct_months_1_2 between 0 and 1),
  cap_cents bigint check (cap_cents >= 0),
  fixed_from_day_61_cents bigint check (fixed_from_day_61_cents >= 0),
  started_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.pilot is 'Paid pilot per account (D37); values open.';

create table public.pilot_charge (
  id uuid primary key default gen_random_uuid(),
  pilot_id uuid not null references public.pilot (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  credited_cents bigint not null default 0,
  charge_cents bigint not null default 0,
  asaas_payment_id text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pilot_id, month)
);

create table public.bpo_partner (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  folder_url text,
  logo_path text,
  primary_color text,
  show_powered_by boolean not null default true,
  price_per_store_cents bigint check (price_per_store_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bpo_client (
  id uuid primary key default gen_random_uuid(),
  bpo_partner_id uuid not null references public.bpo_partner (id) on delete cascade,
  account_id uuid not null references public.account (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bpo_partner_id, account_id)
);

-- §5 Feature flags (D34) --------------------------------------------------------------------------

create table public.feature_flag (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  description text not null,
  default_raio_x boolean not null default false,
  default_lucro boolean not null default false,
  default_rede boolean not null default false,
  env public.flag_env not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, env)
);

create table public.feature_override (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null,
  env public.flag_env not null,
  account_id uuid not null references public.account (id) on delete cascade,
  value boolean not null,
  reason text not null,
  set_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flag_key, env, account_id),
  foreign key (flag_key, env) references public.feature_flag (key, env) on delete cascade
);

create table public.feature_flag_log (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null,
  env public.flag_env not null,
  account_id uuid references public.account (id) on delete cascade,
  old boolean,
  new boolean,
  by uuid references public.person (id) on delete set null,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.feature_flag_log.account_id is 'null: a change to a plan default; set: an account exception.';

-- §5 Notices (D36) --------------------------------------------------------------------------------

create table public.notice_type (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  audience_roles text[] not null,
  email_locked boolean not null default false,
  default_email boolean not null,
  default_whatsapp boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notice_pref (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person (id) on delete cascade,
  account_id uuid not null references public.account (id) on delete cascade,
  notice_code text not null references public.notice_type (code),
  email boolean not null,
  whatsapp boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, account_id, notice_code)
);

create table public.notification (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.account (id) on delete cascade,
  person_id uuid references public.person (id) on delete cascade,
  notice_code text not null references public.notice_type (code),
  channel public.notification_channel not null,
  subject text,
  body text not null,
  status public.notification_status not null default 'queued',
  sent_at timestamptz,
  provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.notification is 'Outbox. The dev provider writes to a local inbox (D40).';

create table public.alert (
  id uuid primary key default gen_random_uuid(),
  severity public.alert_severity not null,
  title text not null,
  account_id uuid references public.account (id) on delete cascade,
  link text,
  notified_via text[] not null default '{}',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((resolved_at is null) = (resolved_by is null))
);
comment on table public.alert is 'Team alerts (C21). Open until someone resolves it (04 §10).';

-- §5 Audit, jobs, extension ----------------------------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_person_id uuid,
  actor_kind public.actor_kind not null,
  account_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_account_at on public.audit_log (account_id, at desc);
comment on table public.audit_log is 'Every write by a person (A04). Append-only. No foreign keys: rows, including the deletion receipt, outlive the account and person they name.';

create table public.job (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  account_id uuid references public.account (id) on delete cascade,
  dedupe_key text,
  status public.job_status not null default 'queued',
  attempts int not null default 0,
  claimed_at timestamptz,
  finished_at timestamptz,
  log jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_queued on public.job (type, created_at) where status = 'queued';
create unique index job_dedupe_active on public.job (type, dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');
comment on table public.job is 'The single queue for imports, collection, matching and rendering (02 §4).';

create table public.extension_token (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person (id) on delete cascade,
  account_id uuid not null references public.account (id) on delete cascade,
  token_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at on every table ----------------------------------------------------------------------

create schema app;
grant usage on schema app to anon, authenticated, service_role;

create function app.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in select table_name from information_schema.tables
           where table_schema = 'public' and table_type = 'BASE TABLE' loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function app.set_updated_at()', t);
  end loop;
end $$;
