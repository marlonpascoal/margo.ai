-- M3 cost and contribution: what worker-cost (CST-01 to CST-04, CTB-01, CTB-02, DLV-01) needs beyond
-- 20261201000001_m3_schema.sql, each for a rule or a screen, listed for Marlon:
--
--   rule_param m3.regional_prior_error_pct  CST-04: how much a CST-02 regional prior widens the error bar
--     ("widens the error bar", 04 §4, no value given; 0.30 reproduces the drawn ± 9% of C12).
--   rule_param m3.top_ingredients           P06, C10: "N de 20" insumos that weigh most.
--   ingredient_match.rule_note              C11 "regra: texto + NCM 0201": which rule matched.
--   menu_item.top20_rank                    C12 lists the 20 dishes in the onboarding order (D15).
--   campaign_item                           C13, DLV-01: the dishes a coupon applies to. M2's campaign is per
--     store (REP-04 stays per order); a campaign without items is not split per dish.
--   recipe.cost_*, recipe_line.price_* and cost_cents   C12 cost per dish and line, written by worker-cost
--     so the screen never recomputes a rule (null while a recompute is pending).
--   contribution.units, campaign_name, campaign_discount_pct, can_invert, prices_as_of
--     C13 order and the coupon row ("Combo casal, cupom 20%"), CTB-02 flag, and the price date of CST-01.
--     One row per close, dish, channel and campaign (none = the dish without campaign).
--   close_cost_line                          W01 "Sobrou" per kitchen and app: insumos of the units sold per store.
--   close_decision                           DLV-01, one per close: C13, P06 and W01 print the same decision.

insert into public.rule_param (key, value, description) values
  ('m3.regional_prior_error_pct', 0.30,
   'CST-04: extra error (fraction) of a line priced by a CST-02 regional prior, on top of its yield error'),
  ('m3.top_ingredients', 20, 'P06, C10: how many insumos, by weight in the cost of the dishes sold, the coverage counts');

alter table public.ingredient_match add column rule_note text;
comment on column public.ingredient_match.rule_note is 'C11 "Como casou" for method rule, e.g. "texto + NCM 0201".';

alter table public.menu_item add column top20_rank smallint check (top20_rank between 1 and 20);
create unique index menu_item_top20_rank on public.menu_item (account_id, top20_rank) where top20_rank is not null;
comment on column public.menu_item.top20_rank is 'C12: position in the top-20 list built at onboarding (D15). Null outside the 20.';

alter table public.campaign add constraint campaign_account_id_id_key unique (account_id, id);
create table public.campaign_item (
  account_id uuid not null references public.account (id) on delete cascade,
  campaign_id uuid not null,
  menu_item_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, menu_item_id),
  foreign key (account_id, campaign_id) references public.campaign (account_id, id) on delete cascade,
  foreign key (account_id, menu_item_id) references public.menu_item (account_id, id) on delete cascade
);
comment on table public.campaign_item is 'C13, DLV-01: dishes a campaign (coupon) discounts. Without rows the campaign is store wide and not split per dish.';

-- C12: written by worker-cost (CST-01 to CST-04) as of cost_as_of; null while a recompute is pending.
alter table public.recipe
  add column cost_cents bigint check (cost_cents >= 0),
  add column error_pct numeric(7, 4) check (error_pct >= 0),
  add column cost_as_of date,
  add column cost_computed_at timestamptz;
alter table public.recipe_line
  add column price_per_base_unit_cents numeric check (price_per_base_unit_cents >= 0),
  add column price_source public.price_source,
  add column price_observed_on date,
  add column cost_cents numeric check (cost_cents >= 0);
comment on column public.recipe_line.cost_cents is 'CST-03: qty_base_units / yield_pct times the CST-01 or CST-02 price, unrounded centavos.';

alter table public.contribution
  add column units int not null default 0 check (units >= 0),
  add column campaign_name text,
  add column campaign_discount_pct numeric(7, 4) check (campaign_discount_pct > 0 and campaign_discount_pct < 1),
  add column can_invert boolean not null default false,
  add column prices_as_of date,
  add constraint contribution_campaign_both check ((campaign_name is null) = (campaign_discount_pct is null));
alter table public.contribution drop constraint contribution_close_period_id_menu_item_id_channel_key;
alter table public.contribution add constraint contribution_close_item_channel_campaign_key
  unique nulls not distinct (close_period_id, menu_item_id, channel, campaign_name);
comment on column public.contribution.units is 'Units of the dish sold in the month on the channel (order_item_fact), with the campaign when set.';
comment on column public.contribution.can_invert is 'CTB-02: ingredient_error_pct times ingredient_cents is larger than |left_cents|.';

create table public.close_cost_line (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  close_period_id uuid not null,
  channel_store_id uuid not null references public.channel_store (id) on delete cascade,
  units int not null default 0 check (units >= 0),
  uncovered_units int not null default 0 check (uncovered_units >= 0),
  ingredient_cents bigint not null default 0 check (ingredient_cents >= 0),
  packaging_cents bigint not null default 0 check (packaging_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (close_period_id, channel_store_id),
  foreign key (account_id, close_period_id) references public.close_period (account_id, id) on delete cascade
);
comment on table public.close_cost_line is
  'W01 Sobrou (CTB-01 for the month): insumos of the units sold per store. uncovered_units: units of dishes without a ready recipe (the row shows "falta custo").';

create type public.decision_kind as enum ('campaign', 'lowest');
create table public.close_decision (
  close_period_id uuid primary key,
  account_id uuid not null references public.account (id) on delete cascade,
  kind public.decision_kind not null,
  menu_item_id uuid not null,
  channel public.channel not null,
  campaign_name text,
  campaign_discount_pct numeric(7, 4),
  left_cents bigint not null,
  base_left_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, close_period_id) references public.close_period (account_id, id) on delete cascade,
  foreign key (account_id, menu_item_id) references public.menu_item (account_id, id) on delete cascade,
  check ((kind = 'campaign') = (campaign_name is not null and campaign_discount_pct is not null and base_left_cents is not null))
);
comment on table public.close_decision is
  'DLV-01: "uma decisão para o mês". campaign: the top-20 dish whose contribution an active campaign cut the most (left with, base_left without). lowest: the dish with the lowest positive contribution.';

do $$
declare t text;
begin
  foreach t in array array['campaign_item', 'close_cost_line', 'close_decision'] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function app.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy read on public.campaign_item for select to authenticated
  using (exists (select 1 from public.campaign c where c.id = campaign_id));
create policy read on public.close_cost_line for select to authenticated
  using (exists (select 1 from public.channel_store cs where cs.id = channel_store_id));
create policy read on public.close_decision for select to authenticated
  using (exists (select 1 from public.close_period cp where cp.id = close_period_id));
