-- M1 extraction intake (D47b, D47c, docs/extract-api.md). Any extractor (the external scraper today, the
-- extension or a licensed feed later) claims work from public.job and hands back structured copies:
--   extract_run      one attempt at a job: who ran it, the request, times, status, error
--   extract_content  structured payload by content hash, so identical copies reuse one row
--   extract_copy     dated copy of one store in one run; append-only (D47c: never rewritten)
--   public_store_private  the street address (D47c): RLS on, no read policy, no screen, PDF, message,
--                    snapshot or E06 export reads it
-- extract_content can hold the street address too (re-applying an old copy must work), so all these tables
-- have RLS on and no policy: only the service role reaches them, and only through the extract functions.

create type public.extract_kind as enum ('discover', 'capture');
create type public.extract_run_status as enum ('running', 'done', 'failed');

create table public.extract_run (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.job (id) on delete set null,
  kind public.extract_kind not null,
  source text,
  worker text,
  request jsonb not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.extract_run_status not null default 'running',
  error text,
  copies int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.extract_run is
  'D47c: one attempt at an extract job. worker comes with the claim, source (scraper, extension, licensed, ...) with the result.';
create unique index extract_run_one_running on public.extract_run (job_id) where status = 'running';
create index extract_run_job on public.extract_run (job_id);

create table public.extract_content (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.extract_content is
  'D47c: allowlisted structured fields of a copy (docs/extract-api.md), by sha-256 of the payload. May hold the street address: no read policy.';

create table public.extract_copy (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.extract_run (id),
  channel public.channel not null,
  store_external_id text not null,
  collected_at timestamptz not null,
  content_hash text not null references public.extract_content (content_hash),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, channel, store_external_id)
);
comment on table public.extract_copy is 'D47c: a dated copy of one store. Append-only: a trigger refuses UPDATE and DELETE.';
create index extract_copy_store on public.extract_copy (channel, store_external_id, collected_at desc);

create function app.extract_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'extract copies are never rewritten (%, D47c)', tg_table_name using errcode = 'restrict_violation';
end $$;

create trigger append_only before update or delete on public.extract_copy
  for each row execute function app.extract_is_append_only();
create trigger append_only before update or delete on public.extract_content
  for each row execute function app.extract_is_append_only();

create table public.public_store_private (
  public_store_id uuid primary key references public.public_store (id) on delete cascade,
  address text not null,
  collected_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.public_store_private is
  'D47c: street address of a public store, internal only. RLS on with no read policy; never reaches a screen, PDF, message, snapshot or the E06 export.';

create trigger set_updated_at before update on public.extract_run
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.public_store_private
  for each row execute function app.set_updated_at();

alter table public.extract_run enable row level security;
alter table public.extract_content enable row level security;
alter table public.extract_copy enable row level security;
alter table public.public_store_private enable row level security;

-- New catalog columns --------------------------------------------------------------------------------

alter table public.public_store
  add column slug text,
  add column main_category_code text,
  add column super_categories text[],
  add column rating numeric(3, 2) check (rating is null or rating between 0 and 5),
  add column rating_count int check (rating_count is null or rating_count >= 0);

alter table public.public_menu_item
  add column category text,
  add column taxonomy_level1 text,
  add column taxonomy_level2 text,
  add column original_price_cents bigint check (original_price_cents is null or original_price_cents >= 0),
  add column minimum_price_cents bigint check (minimum_price_cents is null or minimum_price_cents >= 0),
  add column removed_at timestamptz,
  add column comparison_price_cents bigint generated always as (
    case when price_cents = 0 and minimum_price_cents is not null then minimum_price_cents else price_cents end
  ) stored;
comment on column public.public_menu_item.removed_at is
  'D47c: when a newer capture no longer listed the item. Removed items are marked, never deleted, and stay out of pairing, calculation and new snapshots.';
comment on column public.public_menu_item.original_price_cents is
  'Price before a promotion. Stored only: M1-05 keeps using the current price until Marlon decides the promotion question.';
comment on column public.public_menu_item.comparison_price_cents is
  'M1-05: the price that enters parity: price_cents, or minimum_price_cents when price_cents is 0.';

-- Param and flag (04 §1, §6) ---------------------------------------------------------------------------

insert into public.rule_param (key, value, description) values
  ('m1.extract_every_days', 7, 'D47c: days between captures of a store in an active X-ray');

insert into public.feature_flag (key, description, default_raio_x, default_lucro, default_rede, env)
select 'm1.extracao', 'Extração de lojas e cardápios por serviço externo', e.is_on, e.is_on, e.is_on, e.env
from (values ('sandbox'::public.flag_env, true), ('production'::public.flag_env, false)) as e (env, is_on);
