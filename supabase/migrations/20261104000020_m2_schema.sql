-- M2. Channel data and close (03 §3, 04 §2, §3, §11, D30, D31).
--
-- Canonical rows come from the file parsers (worker-import) and, later, the iFood API adapter: both
-- write order_fact, order_item_fact and ledger_entry with the same natural keys, so a re-import adds
-- zero rows (D31). Writes go through the worker or audited server actions with the service role;
-- RLS policies are SELECT only (20261104000021_m2_rls.sql).
--
-- Additions to 03 §3, each needed by a rule or a screen and listed for Marlon:
--   order_fact.cancelled_by, cancel_reason (DIF-02 needs whose fault a cancellation was);
--   order_fact.import_run_id, order_item_fact.account_id, close_line.account_id (RLS, provenance);
--   import_run.file_name, file_sha256, created_by, mapping_id (C07 "upload (Manuel)", C17);
--   column_mapping.name (C17 shows which layout matched);
--   difference.finding_key, shown, detail (recompute idempotence, the R$ 5,00 rule, claim text numbers);
--   difference_order (C09 "each row links to the orders that produced it");
--   contestation.marked_by_kind, closed_at (C16 "Quem marcou: MargoAI"; 04 §3 "closed (no difference)");
--   rule_param (04 "values marked param live in a settings table").

-- Enums ---------------------------------------------------------------------------------------------

create type public.import_kind as enum ('api', 'extension', 'upload', 'bpo_folder', 'whatsapp');
create type public.import_trigger as enum ('schedule', 'extension', 'upload', 'rerun', 'manual');
create type public.import_status as enum ('queued', 'running', 'ok', 'failed', 'needs_mapping');
create type public.order_status as enum ('concluido', 'cancelado');
create type public.cancel_party as enum ('loja', 'cliente', 'canal');
create type public.ledger_type as enum (
  'commission', 'payment_fee', 'delivery', 'promotion', 'subsidy', 'refund', 'cancellation',
  'anticipation', 'adjustment', 'payout', 'other'
);
create type public.delivery_model as enum ('canal', 'loja');
create type public.close_status as enum ('open', 'computed', 'delivered');
create type public.difference_confidence as enum ('certa', 'provavel', 'duvidosa');
create type public.contestation_status as enum (
  'a_contestar', 'precisa_resposta', 'contestada', 'creditada', 'negada', 'prazo_vencido'
);

-- Params (04: values marked param) ------------------------------------------------------------------

create table public.rule_param (
  key text primary key,
  value numeric not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.rule_param is 'Rule parameters (04 "param"): read by workers and screens, never hard-coded.';

insert into public.rule_param (key, value, description) values
  ('m2.dif_min_cents', 500, '04 §2: a difference below this total per rule per month is recorded but not shown (R$ 5,00)'),
  ('m2.dif04_grace_days', 7, 'DIF-04: days after the expected payment date before a missing payout is certain'),
  ('m2.deadline_days.ifood', 30, '04 §3: contestation deadline in days from the order, iFood (until the portal confirms)'),
  ('m2.deadline_days.food99', 30, '04 §3: contestation deadline in days from the order, 99Food'),
  ('m2.credit_match_pct', 0.10, '04 §3: a credit matches a contested difference within this fraction of the amount'),
  ('m2.rounding_tolerance_cents', 1, 'REP: a charge within this many centavos of the expected value is rounding, not a difference');

-- Imports (D31, 04 §11) ------------------------------------------------------------------------------

create table public.import_source (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  channel public.channel not null,
  kind public.import_kind not null,
  schedule_cron text,
  last_ok_at timestamptz,
  stale_after_hours int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, channel, kind)
);
comment on table public.import_source is 'C07 source cards: iFood API, Chrome extension, files.';

create table public.column_mapping (
  id uuid primary key default gen_random_uuid(),
  channel public.channel not null,
  file_signature text not null,
  name text not null,
  mapping jsonb not null,
  created_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, file_signature)
);
comment on table public.column_mapping is
  'C17: header names to canonical fields, saved per file layout (signature of the normalized header row) and reused.';

create table public.import_run (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  source_id uuid references public.import_source (id) on delete set null,
  trigger public.import_trigger not null,
  channel public.channel not null,
  store_ids uuid[] not null default '{}',
  period_start date,
  period_end date,
  file_path text,
  file_name text,
  file_sha256 text,
  rows_total int,
  rows_new int,
  rows_duplicate int,
  duration_ms int,
  status public.import_status not null default 'queued',
  log jsonb not null default '{}',
  job_id uuid references public.job (id) on delete set null,
  mapping_id uuid references public.column_mapping (id) on delete set null,
  created_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_run_account_created on public.import_run (account_id, created_at desc);
comment on table public.import_run is 'Import history (D31): every run, its counts, status and log of ids only.';
comment on column public.import_run.log is
  'Parse result for C07 and C17: {"columns": [{"name", "example"}], "rows_in_file", "payout_total_cents", "events": [...]}.';

-- Canonical facts (03 §3) ----------------------------------------------------------------------------

create table public.order_fact (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  channel_store_id uuid not null references public.channel_store (id) on delete cascade,
  external_order_id text not null,
  ordered_at timestamptz not null,
  gross_cents bigint not null,
  items_cents bigint not null,
  delivery_fee_cents bigint not null default 0,
  discount_store_cents bigint not null default 0,
  discount_channel_cents bigint not null default 0,
  status public.order_status not null,
  cancelled_by public.cancel_party,
  cancel_reason text,
  import_run_id uuid references public.import_run (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_store_id, external_order_id),
  unique (account_id, id)
);
create index order_fact_store_ordered on public.order_fact (channel_store_id, ordered_at);

create table public.order_item_fact (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  order_fact_id uuid not null,
  line_no int not null,
  item_name text not null,
  external_item_id text,
  qty numeric not null,
  unit_price_cents bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_fact_id, line_no),
  foreign key (account_id, order_fact_id) references public.order_fact (account_id, id) on delete cascade
);

create table public.ledger_entry (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  channel_store_id uuid not null references public.channel_store (id) on delete cascade,
  external_entry_id text not null,
  order_fact_id uuid references public.order_fact (id) on delete set null,
  entry_date date not null,
  expected_payment_date date,
  type public.ledger_type not null,
  raw_type text,
  amount_cents bigint not null,
  import_run_id uuid references public.import_run (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_store_id, external_entry_id)
);
create index ledger_entry_store_date on public.ledger_entry (channel_store_id, entry_date);
create index ledger_entry_order on public.ledger_entry (order_fact_id) where order_fact_id is not null;
comment on column public.ledger_entry.amount_cents is 'Signed: credits to the store positive, debits negative.';

create table public.contract_terms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  channel_store_id uuid not null references public.channel_store (id) on delete cascade,
  plan_name text not null,
  commission_pct numeric(7,4) not null,
  payment_fee_pct numeric(7,4) not null,
  delivery_model public.delivery_model not null,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
comment on table public.contract_terms is 'REP-01 to REP-03 inputs, one row per plan period of a channel store.';

create table public.campaign (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  channel_store_id uuid not null references public.channel_store (id) on delete cascade,
  name text not null,
  discount_pct numeric(7,4) not null,
  channel_share_pct numeric(7,4) not null check (channel_share_pct between 0 and 1),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
comment on table public.campaign is 'REP-04, DIF-03: co-funded promotions and who pays which share.';

-- Close, differences, contestations (C08, C09, C16) --------------------------------------------------

create table public.close_period (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  kitchen_id uuid,
  month date not null check (extract(day from month) = 1),
  status public.close_status not null default 'open',
  computed_at timestamptz,
  pdf_path text,
  xlsx_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (account_id, kitchen_id, month),
  foreign key (account_id, kitchen_id) references public.kitchen (account_id, id) on delete cascade
);
comment on column public.close_period.kitchen_id is 'Null: the whole account (C08 per account, P06).';

create table public.close_line (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  close_period_id uuid not null references public.close_period (id) on delete cascade,
  channel_store_id uuid not null references public.channel_store (id) on delete cascade,
  gross_cents bigint not null,
  commission_cents bigint not null,
  payment_cents bigint not null,
  delivery_cents bigint not null,
  promotion_cents bigint not null,
  anticipation_cents bigint not null,
  payout_cents bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (close_period_id, channel_store_id)
);
comment on table public.close_line is
  'C08, P06: sums per store for the month. Deductions and payout are signed ledger sums (debits negative).';

create table public.difference (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  close_period_id uuid not null references public.close_period (id) on delete cascade,
  channel_store_id uuid not null references public.channel_store (id) on delete cascade,
  rule_id text not null check (rule_id ~ '^DIF-\d{2}$'),
  finding_key text not null,
  description text not null,
  orders_count int not null,
  amount_cents bigint not null,
  confidence public.difference_confidence not null,
  shown boolean not null default true,
  detail jsonb not null default '{}',
  evidence_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (close_period_id, channel_store_id, finding_key),
  unique (account_id, id)
);
comment on column public.difference.shown is '04 §2: false when the rule''s total for the month is below m2.dif_min_cents.';

create table public.difference_order (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  difference_id uuid not null,
  order_fact_id uuid not null references public.order_fact (id) on delete cascade,
  amount_cents bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (difference_id, order_fact_id),
  foreign key (account_id, difference_id) references public.difference (account_id, id) on delete cascade
);
comment on table public.difference_order is 'C09 evidence: the orders behind each difference and the amount of each.';

create table public.contestation (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  difference_id uuid not null unique,
  status public.contestation_status not null,
  deadline_on date,
  protocol text,
  claim_text text,
  marked_by uuid references public.person (id) on delete set null,
  marked_by_kind public.actor_kind,
  marked_at timestamptz,
  closed_at timestamptz,
  credited_entry_id uuid references public.ledger_entry (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, difference_id) references public.difference (account_id, id) on delete cascade
);
comment on column public.contestation.closed_at is
  '04 §3 "closed (no difference)": the owner answered that a probable difference was agreed. Status stays precisa_resposta.';

-- updated_at on every new table (the base migration's loop ran before these existed).
do $$
declare t text;
begin
  foreach t in array array[
    'rule_param', 'import_source', 'column_mapping', 'import_run', 'order_fact', 'order_item_fact',
    'ledger_entry', 'contract_terms', 'campaign', 'close_period', 'close_line', 'difference',
    'difference_order', 'contestation'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function app.set_updated_at()', t);
  end loop;
end $$;
