-- 03 §2 M1, price X-ray: public catalog cache, X-ray runs, neighborhood, items, pairs, hours.
-- Plus menu_item (03 §4, shared by M1 and M3) because xray_item points at it, and the collector's raw page
-- cache (D47: raw pages cached 7 days).
--
-- Columns beyond 03 §2, each needed by a rule or a screen:
--   public_store.area           D47 stores the address area; C02 shows "Igapó, Londrina".
--   xray.collected_at           reference date for "fechada há N dias" (M1-02) and the P01 date.
--   xray.created_by             who started the run (C02).
--   xray_store.delivers_to_target  M1-02 third toggle; null when the page did not say.
--   xray_item.public_menu_item_id  the target store's own item: a lead has no menu_item yet (account_id null).
--   xray_item.pair_note         why an item is `revisar` (C04: "poucos pares", "combos diferentes").
--   xray_item.weekly_units      M1-08 expected weekly units "when known"; null counts as 1.
--   xray_item.reviewed_by/_at, skipped   C04: a founder reviewed or skipped a `revisar` item.
--   xray_item.pareto_rank/_cum_share     M1-08 result, stored so screens and PDF never recompute it.
--   xray_pair.similarity        M1-04 name similarity of the pair.

create type public.xray_status as enum ('draft', 'collecting', 'pairing', 'ready', 'delivered');
create type public.menu_unit as enum ('un', 'g', 'ml', 'pack');
create type public.xray_reading as enum ('pode_subir', 'na_media', 'nao_mexer');
create type public.pair_status as enum ('auto', 'revisar', 'normalizado', 'manual');

-- §4 menu_item (shared by M1 and M3) ---------------------------------------------------------------

create table public.menu_item (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  brand_id uuid not null,
  name text not null,
  channel_item_ids jsonb not null default '{}',
  is_top20 boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, brand_id) references public.brand (account_id, id) on delete cascade
);
comment on table public.menu_item is '03 §4: a dish of a brand. Shared by M1 (xray_item) and M3 (recipes).';

-- §2 Public catalog (D47: public pages only, no personal data) ------------------------------------

create table public.public_store (
  id uuid primary key default gen_random_uuid(),
  channel public.channel not null,
  external_id text not null,
  name text,
  url text,
  area text,
  category text,
  lat numeric(9, 6),
  lng numeric(9, 6),
  last_seen_open_at timestamptz,
  is_national_chain boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_id)
);
comment on table public.public_store is
  '03 §2 public catalog cache (D47). Store name, id, URL, address area, category; no personal data. name is null until the first collection.';

create table public.public_menu_item (
  id uuid primary key default gen_random_uuid(),
  public_store_id uuid not null references public.public_store (id) on delete cascade,
  external_item_id text not null,
  name text not null,
  description text,
  price_cents bigint not null check (price_cents >= 0),
  unit public.menu_unit not null default 'un',
  unit_qty numeric(10, 2) check (unit_qty is null or unit_qty > 0),
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (public_store_id, external_item_id)
);
comment on column public.public_menu_item.unit_qty is
  'M1-03: grams (g), millilitres (ml), units in the item (un, pack). Null for a pack of mixed items (a combo).';

-- D47: raw pages cached 7 days. Service role only (RLS on, no policy).
create table public.collector_page_cache (
  url text primary key,
  status int not null,
  body bytea not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at <= fetched_at + interval '7 days')
);
comment on table public.collector_page_cache is 'D47: raw public pages, kept at most 7 days; the collector purges expired rows on every run.';

-- §2 X-ray runs ------------------------------------------------------------------------------------

create table public.xray (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.account (id) on delete cascade,
  target_store_id uuid not null references public.public_store (id),
  radius_km int not null default 3 check (radius_km in (2, 3, 5)),
  categories text[] not null default '{}',
  rules jsonb not null default '{}',
  status public.xray_status not null default 'draft',
  collected_at timestamptz,
  delivered_at timestamptz,
  pdf_path text,
  created_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'delivered' or delivered_at is not null)
);
comment on table public.xray is
  '03 §2: one X-ray run (C02 to C06). account_id null for a lead without an account. rules: M1-02 toggles and M1-04/M1-07 params.';

create table public.xray_store (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  public_store_id uuid not null references public.public_store (id),
  distance_m int not null check (distance_m >= 0),
  delivers_to_target boolean,
  included boolean not null,
  exclusion_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_id, public_store_id),
  check (included or exclusion_reason is not null)
);
comment on column public.xray_store.exclusion_reason is
  'C03 text as shown: "regra: rede tabelada", "regra: fechada há N dias", "regra: não entrega no bairro" (M1-02), or "manual..." for a founder toggle (kept when the rules run again).';

create table public.xray_item (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  public_menu_item_id uuid not null references public.public_menu_item (id),
  menu_item_id uuid references public.menu_item (id) on delete set null,
  norm_unit text not null check (norm_unit in ('un', '100g', '100ml', 'combo')),
  norm_price_cents bigint not null,
  parity_cents bigint,
  gap_pct numeric(7, 4),
  loss_cents bigint,
  reading public.xray_reading,
  pair_status public.pair_status not null,
  pair_note text,
  weekly_units numeric(10, 2) check (weekly_units is null or weekly_units >= 0),
  reviewed_by uuid references public.person (id) on delete set null,
  reviewed_at timestamptz,
  skipped boolean not null default false,
  pareto_rank int,
  pareto_cum_share numeric(7, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_id, public_menu_item_id),
  check ((reviewed_by is null) = (reviewed_at is null))
);
comment on table public.xray_item is
  '03 §2, C04 and C05. pair_status is the M1-03/M1-04 outcome; a founder review keeps it and sets reviewed_at.';

create table public.xray_pair (
  id uuid primary key default gen_random_uuid(),
  xray_item_id uuid not null references public.xray_item (id) on delete cascade,
  public_menu_item_id uuid not null references public.public_menu_item (id),
  similarity numeric(5, 4) not null,
  accepted boolean not null,
  by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_item_id, public_menu_item_id)
);
comment on column public.xray_pair.by is 'null: decided by the rules (M1-04); set: a founder accepted or rejected the pair in C04.';

create table public.time_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.account (id) on delete cascade,
  xray_id uuid references public.xray (id) on delete cascade,
  step text not null,
  minutes int not null check (minutes >= 0),
  person_id uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index time_log_xray_step_person on public.time_log (xray_id, step, person_id) where xray_id is not null;
comment on table public.time_log is '03 §2: hours per step (V1 criterion, C06, C01).';

create index xray_store_xray on public.xray_store (xray_id);
create index xray_item_xray on public.xray_item (xray_id);
create index xray_pair_item on public.xray_pair (xray_item_id);
create index public_menu_item_store on public.public_menu_item (public_store_id);

do $$
declare t text;
begin
  foreach t in array array['menu_item', 'public_store', 'public_menu_item', 'collector_page_cache', 'xray',
                           'xray_store', 'xray_item', 'xray_pair', 'time_log'] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function app.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- RLS: read only, staff (console). Writes go through the audited functions of 20261104000011 or the
-- workers with the service role. The owner's view of an X-ray (04 §5 "see price X-ray") comes with the
-- portal in wave 2.
create policy read on public.menu_item for select to authenticated using (app.is_staff());
create policy read on public.public_store for select to authenticated using (app.is_staff());
create policy read on public.public_menu_item for select to authenticated using (app.is_staff());
create policy read on public.xray for select to authenticated using (app.is_staff());
create policy read on public.xray_store for select to authenticated using (app.is_staff());
create policy read on public.xray_item for select to authenticated using (app.is_staff());
create policy read on public.xray_pair for select to authenticated using (app.is_staff());
create policy read on public.time_log for select to authenticated using (app.is_staff());

-- P01 PDFs (02 §1: Storage for files and PDFs). Private: the console serves them after its own check.
insert into storage.buckets (id, name, public) values ('pdf', 'pdf', false) on conflict (id) do nothing;
