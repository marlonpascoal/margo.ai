-- M3. Cost and contribution (03 §4, 04 §4, 06 §5, §6, D11, D13, D14, D15).
--
-- Invoices come from the accountant's XML zip, a typed key or a QR link (06 §5); worker-match links
-- each line to the global ingredient catalog (rule, GTIN, AI suggestion, manual), confirmed lines
-- become ingredient prices (CST-01), recipes turn prices into dish cost (CST-03, CST-04) and the
-- close computes contribution per dish and channel (CTB-01). Writes go through workers or audited
-- server actions with the service role; RLS policies are SELECT only (20261201000002_m3_rls.sql).
--
-- menu_item already exists (20261104000010_m1_schema.sql) with every 03 §4 column.
--
-- Additions to 03 §4, each needed by a rule, a screen or the one-account rule, listed for Marlon:
--   invoice_line.account_id, ingredient_match.account_id, recipe_line.account_id (composite FKs keep
--     every row in one account, as in M2);
--   invoice_line.line_no (nItem of the XML: idempotent re-parse of the same invoice);
--   ingredient_match.confidence (06 §6: the AI suggestion carries a confidence);
--   contribution.packaging_cents (CTB-01 subtracts packaging; the row must trace every term);
--   close_period unique (account_id, id) so contribution can use a composite FK.

-- Enums ---------------------------------------------------------------------------------------------

create type public.invoice_source as enum ('xml_zip', 'key_typed', 'qr_url', 'whatsapp_photo');
create type public.base_unit as enum ('g', 'ml', 'un');
create type public.match_method as enum ('gtin', 'rule', 'ai', 'manual');
create type public.match_status as enum ('suggested', 'confirmed', 'rejected');
create type public.price_source as enum ('invoice', 'regional_prior');
create type public.recipe_status as enum ('draft', 'ready');
create type public.yield_confidence as enum ('medido', 'declarado', 'estimado');

-- Params (04 §4: values marked param) ---------------------------------------------------------------

insert into public.rule_param (key, value, description) values
  ('m3.price_window_days', 90, 'CST-01: latest confirmed invoice price within this many days; older falls to CST-02'),
  ('m3.yield_error_pct.medido', 0.02, 'CST-04: error of a measured yield (fraction)'),
  ('m3.yield_error_pct.declarado', 0.05, 'CST-04: error of a declared yield (fraction)'),
  ('m3.yield_error_pct.estimado', 0.10, 'CST-04: error of an estimated yield (fraction)');

-- 06 §5: NF-e and NFC-e access key, 44 digits, last digit mod 11 over the first 43 (weights 2 to 9
-- from the right; remainder 0 or 1 gives 0).
create function app.nfe_access_key_valid(k text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare s int := 0; w int := 2; r int;
begin
  if k is null or k !~ '^\d{44}$' then return false; end if;
  for i in reverse 43..1 loop
    s := s + substr(k, i, 1)::int * w;
    w := case when w = 9 then 2 else w + 1 end;
  end loop;
  r := s % 11;
  return substr(k, 44, 1)::int = case when r < 2 then 0 else 11 - r end;
end $$;
revoke all on function app.nfe_access_key_valid(text) from public;
grant execute on function app.nfe_access_key_valid(text) to anon, authenticated, service_role;

alter table public.close_period add constraint close_period_account_id_id_key unique (account_id, id);

-- Invoices (D11, D13) -------------------------------------------------------------------------------

create table public.invoice (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  company_id uuid not null,
  access_key text not null unique check (app.nfe_access_key_valid(access_key)),
  model smallint not null check (model in (55, 65)),
  issuer_cnpj text not null check (issuer_cnpj ~ '^(\d{11}|\d{14})$'),
  issuer_name text,
  issued_at timestamptz not null,
  total_cents bigint not null check (total_cents >= 0),
  source public.invoice_source not null,
  xml_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  check (model = substr(access_key, 21, 2)::smallint),
  foreign key (account_id, company_id) references public.company (account_id, id) on delete cascade
);
create index invoice_account_issued on public.invoice (account_id, issued_at desc);
comment on table public.invoice is
  '03 §4: purchase invoice (NF-e 55, NFC-e 65). Deduped by access_key across all accounts (D11). company_id: the buyer company of the account.';
comment on column public.invoice.xml_path is 'Path in the private invoices bucket; null for a typed key or QR link without XML.';

create table public.invoice_line (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  invoice_id uuid not null,
  line_no int not null check (line_no > 0),
  description text not null,
  ncm text check (ncm ~ '^\d{8}$'),
  gtin text check (gtin ~ '^(\d{8}|\d{12}|\d{13}|\d{14})$'),
  unit text not null,
  qty numeric not null check (qty > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, line_no),
  unique (account_id, id),
  foreign key (account_id, invoice_id) references public.invoice (account_id, id) on delete cascade
);
comment on column public.invoice_line.gtin is 'Null when the XML says SEM GTIN.';

-- Global ingredient catalog (D14: the asset, shared across clients) ---------------------------------

create table public.ingredient (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null,
  base_unit public.base_unit not null,
  gtin text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ingredient_gtin on public.ingredient using gin (gtin);
comment on table public.ingredient is '03 §4: global catalog, no account_id (D14). category keys the CST-02 regional prior.';

create table public.ingredient_match (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  invoice_line_id uuid not null,
  ingredient_id uuid not null references public.ingredient (id) on delete cascade,
  method public.match_method not null,
  status public.match_status not null default 'suggested',
  confidence numeric(5, 4) check (confidence between 0 and 1),
  confirmed_by uuid references public.person (id) on delete set null,
  conversion_factor numeric check (conversion_factor > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_line_id, ingredient_id),
  foreign key (account_id, invoice_line_id) references public.invoice_line (account_id, id) on delete cascade,
  check (status <> 'confirmed' or conversion_factor is not null),
  check (method <> 'ai' or status <> 'confirmed' or confirmed_by is not null)
);
create unique index ingredient_match_one_confirmed on public.ingredient_match (invoice_line_id) where status = 'confirmed';
comment on table public.ingredient_match is
  '03 §4, C11: de-para. AI suggestions never count until confirmed by a person (D14). At most one confirmed match per line.';
comment on column public.ingredient_match.conversion_factor is
  'Base units (ingredient.base_unit) per invoice unit, e.g. 1000 for a kg line of a g ingredient.';

create table public.ingredient_price (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  ingredient_id uuid not null references public.ingredient (id) on delete cascade,
  price_per_base_unit_cents numeric not null check (price_per_base_unit_cents >= 0),
  observed_on date not null,
  source public.price_source not null,
  invoice_line_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, invoice_line_id) references public.invoice_line (account_id, id) on delete cascade,
  check ((source = 'invoice') = (invoice_line_id is not null))
);
create unique index ingredient_price_line on public.ingredient_price (invoice_line_id) where invoice_line_id is not null;
create index ingredient_price_lookup on public.ingredient_price (account_id, ingredient_id, observed_on desc);
comment on table public.ingredient_price is
  'CST-01 (source invoice, from a confirmed match) and CST-02 (regional_prior, shown as "estimativa regional"). Centavos per base unit, fractional.';

-- Recipes and costs (D15) ---------------------------------------------------------------------------

create table public.recipe (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  menu_item_id uuid not null,
  status public.recipe_status not null default 'draft',
  built_by uuid references public.person (id) on delete set null,
  built_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, menu_item_id) references public.menu_item (account_id, id) on delete cascade
);
create unique index recipe_one_ready on public.recipe (menu_item_id) where status = 'ready';
comment on table public.recipe is '03 §4: ficha técnica (D15). At most one ready recipe per dish; drafts may coexist.';

create table public.recipe_line (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  recipe_id uuid not null,
  ingredient_id uuid not null references public.ingredient (id),
  qty_base_units numeric not null check (qty_base_units > 0),
  yield_pct numeric(7, 4) not null check (yield_pct > 0),
  yield_confidence public.yield_confidence not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, recipe_id) references public.recipe (account_id, id) on delete cascade
);
create index recipe_line_recipe on public.recipe_line (recipe_id);
comment on column public.recipe_line.yield_pct is 'CST-03 fraction: line cost = qty_base_units / yield_pct times price. May exceed 1 (rice).';

create table public.packaging_cost (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  menu_item_id uuid not null,
  channel public.channel not null,
  cost_cents bigint not null check (cost_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_item_id, channel),
  foreign key (account_id, menu_item_id) references public.menu_item (account_id, id) on delete cascade
);

create table public.contribution (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  close_period_id uuid not null,
  menu_item_id uuid not null,
  channel public.channel not null,
  price_cents bigint not null,
  channel_take_cents bigint not null,
  ingredient_cents bigint not null,
  ingredient_error_pct numeric(7, 4) not null check (ingredient_error_pct >= 0),
  packaging_cents bigint not null default 0,
  left_cents bigint not null,
  left_pct numeric(7, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (close_period_id, menu_item_id, channel),
  foreign key (account_id, close_period_id) references public.close_period (account_id, id) on delete cascade,
  foreign key (account_id, menu_item_id) references public.menu_item (account_id, id) on delete cascade,
  check (left_cents = price_cents - channel_take_cents - ingredient_cents - packaging_cents)
);
comment on table public.contribution is
  'C13, P06, CTB-01 per order of the dish: left = price - channel take - ingredient - packaging. Takes and costs positive. CTB-02 compares ingredient_error_pct times ingredient_cents with left_cents.';

do $$
declare t text;
begin
  foreach t in array array[
    'invoice', 'invoice_line', 'ingredient', 'ingredient_match', 'ingredient_price', 'recipe', 'recipe_line',
    'packaging_cost', 'contribution'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function app.set_updated_at()', t);
  end loop;
end $$;
