-- M1 positions and menu score per run (Marlon, 07/nov, for the owner journey history; PROVISIONAL, proposed rule M1-12
-- in spec/04-rules.md). Written once per run, right after its M1-10 ranking (same moment, same items), never rewritten:
--   xray_category_rank   M1-10 restricted to the items of one M1-04 category: price index = median over the target's
--                        items of that category of (store price per base unit / median of the accepted comparables);
--                        a neighbor is ranked with at least m1.rank_min_items items of the category, the target with one
--   xray_item_position   per own item with a parity: its percentile among the accepted comparable stores (0 cheapest,
--                        100 dearest; 100 x (stores cheaper + half the stores at the same price) / stores), its rank
--                        among the stores selling it, the target included (1 = cheapest), and its M1-12 inputs
--   xray_menu_score      M1-12 "score de preço" (Marlon, 07/nov), the share of the neighborhood price the store charges, for the menu ('menu') and per category, over the
--                        items with a parity, each weighted by expected weekly units when known, else 1 (as M1-08):
--                        captured = parity when the M1-07 reading is not pode_subir, else the own price;
--                        score = round(100 x sum(captured) / sum(parity)). Beside it: "diferença de preço por venda"
--                        (sum of parity minus own price of the pode_subir items) and the nao_mexer count as "risco", never
--                        in the score. A category with fewer than m1.score_min_items items has a null score and its count.
--                        The change against the previous run of the same monitoring covers only the items scored in both
--                        (delta, delta_items). Each value keeps its formula version (app.score_version_m1_12, v2); the
--                        formula lives in app.score_captured_m1_12 and the aggregate below only.
-- A run calculated before this migration has none of them; the history starts at the first run that has them.

insert into public.rule_param (key, value, description) values
  ('m1.score_min_items', 5, 'PROVISIONAL M1-12: a category needs this many items with a parity for a score');

create table public.xray_category_rank (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  item_category text not null,
  public_store_id uuid not null references public.public_store (id),
  is_target boolean not null,
  price_index numeric(7, 4) not null check (price_index > 0),
  items_compared int not null check (items_compared > 0),
  rank int not null check (rank > 0),
  stores_ranked int not null check (stores_ranked >= rank),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_id, item_category, public_store_id)
);
comment on table public.xray_category_rank is 'M1-10 per M1-04 category, one row per store ranked in the category. Never updated.';

create table public.xray_item_position (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  xray_item_id uuid not null references public.xray_item (id) on delete cascade,
  public_menu_item_id uuid not null references public.public_menu_item (id),
  item_category text,
  percentile numeric(5, 2) not null check (percentile between 0 and 100),
  rank int not null check (rank > 0),
  stores int not null check (stores >= rank),
  reading public.xray_reading,
  own_cents bigint,
  parity_cents bigint,
  captured_cents bigint,
  score_weight numeric(10, 2),
  score_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_id, xray_item_id)
);
comment on table public.xray_item_position is
  'Product position in a run: percentile among the accepted comparable stores (0 cheapest, 100 dearest), rank among the stores selling it (target included), and its M1-12 inputs. Never updated.';

create table public.xray_menu_score (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  scope text not null,
  score int check (score between 0 and 100),
  score_version text not null,
  items int not null check (items > 0),
  in_band int not null,
  below int not null,
  risk int not null,
  price_gap_per_sale_cents bigint not null,
  previous_xray_id uuid references public.xray (id) on delete set null,
  delta int,
  delta_items int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_id, scope)
);
comment on table public.xray_menu_score is
  'M1-12 (proposed) "score de preço": share of the neighborhood price the store charges, 0 to 100 of a run, scope ''menu'' or an M1-04 category, with the price gap per sale and the nao_mexer count (risco). Never updated.';

do $$
declare t text;
begin
  foreach t in array array['xray_category_rank', 'xray_item_position', 'xray_menu_score'] loop
    execute format('create trigger immutable before update on public.%I
                    for each row execute function app.history_is_immutable()', t);
    execute format('alter table public.%I enable row level security', t);
    -- Console like xray_store_rank; the portal reads them through the monitor loaders (service role).
    execute format('create policy read on public.%I for select to authenticated using (app.is_staff())', t);
  end loop;
end $$;

-- M1-12, the one place the item formula lives. A new formula replaces this function and bumps the version.
create function app.score_version_m1_12() returns text language sql immutable set search_path = '' as $$ select 'm1-12.v2' $$;
create function app.score_captured_m1_12(p_reading public.xray_reading, p_own bigint, p_parity bigint) returns bigint
language sql immutable set search_path = '' as $$
  select case when p_reading = 'pode_subir' then p_own else p_parity end
$$;

-- Writes the three for a run, once: the same items M1-10 ranks (parity, not skipped, current rows).
create function app.positions_xray(p_xray uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  min_items int := coalesce((select p.value::int from public.rule_param p where p.key = 'm1.rank_min_items'), 3);
  min_score_items int := app.monitor_param('m1.score_min_items', 5)::int;
  prev uuid;
begin
  select * into x from public.xray where id = p_xray;
  if not found or (exists (select 1 from public.xray_menu_score s where s.xray_id = p_xray)
                   and exists (select 1 from public.xray_item_position s where s.xray_id = p_xray)) then
    return;
  end if;

  create temp table pos_items on commit drop as
  select xi.id, xi.public_menu_item_id, xi.item_category, xi.reading, xi.parity_cents, coalesce(xi.weekly_units, 1) as w,
         coalesce(sn.price_cents, own.comparison_price_cents) as own_cents,
         own.public_store_id as own_store, app.base_unit_m1_03(own.unit, own.unit_qty) as own_unit,
         app.per_base_m1_03(own.comparison_price_cents, own.unit, own.unit_qty) as own_base
    from public.xray_item xi join public.public_menu_item own on own.id = xi.public_menu_item_id
    left join public.public_menu_item_snapshot sn on sn.xray_id = xi.xray_id and sn.public_menu_item_id = own.id
   where xi.xray_id = p_xray and xi.parity_cents is not null and not xi.skipped and own.removed_at is null;

  create temp table pos_comps on commit drop as
  select it.id as item_id, c.public_store_id, avg(app.per_base_m1_03(c.comparison_price_cents, c.unit, c.unit_qty)) as base
    from pos_items it
    join public.xray_pair p on p.xray_item_id = it.id and p.accepted
    join public.public_menu_item c on c.id = p.public_menu_item_id and c.removed_at is null
     and app.base_unit_m1_03(c.unit, c.unit_qty) = it.own_unit
   group by it.id, c.public_store_id;

  -- Category position (M1-10 per category).
  with med as (
    select item_id, percentile_cont(0.5) within group (order by base) as m from pos_comps group by item_id
    having percentile_cont(0.5) within group (order by base) > 0
  ), ratios as (
    select it.item_category as cat, it.own_store as store, it.own_base / med.m as ratio
      from pos_items it join med on med.item_id = it.id where it.item_category is not null
    union all
    select it.item_category, c.public_store_id, c.base / med.m
      from pos_comps c join med on med.item_id = c.item_id join pos_items it on it.id = c.item_id
     where it.item_category is not null
  ), idx as (
    select cat, store, round(percentile_cont(0.5) within group (order by ratio)::numeric, 4) as price_index, count(*)::int as n
      from ratios group by cat, store
  ), kept as (
    select * from idx where store = x.target_store_id or n >= min_items
  )
  insert into public.xray_category_rank (xray_id, item_category, public_store_id, is_target, price_index, items_compared,
                                         rank, stores_ranked)
  select p_xray, cat, store, store = x.target_store_id, greatest(price_index, 0.0001), n,
         rank() over (partition by cat order by price_index), count(*) over (partition by cat)
    from kept
  on conflict (xray_id, item_category, public_store_id) do nothing;

  -- Product position, with the item's M1-12 inputs.
  insert into public.xray_item_position (xray_id, xray_item_id, public_menu_item_id, item_category, percentile, rank, stores,
                                         reading, own_cents, parity_cents, captured_cents, score_weight, score_version)
  select p_xray, it.id, it.public_menu_item_id, it.item_category,
         round(100.0 * (count(*) filter (where c.base < it.own_base) + 0.5 * count(*) filter (where c.base = it.own_base))
               / count(*), 2),
         1 + count(*) filter (where c.base < it.own_base), count(*) + 1,
         it.reading, it.own_cents, it.parity_cents, app.score_captured_m1_12(it.reading, it.own_cents, it.parity_cents),
         it.w, app.score_version_m1_12()
    from pos_items it join pos_comps c on c.item_id = it.id
   group by it.id, it.public_menu_item_id, it.item_category, it.own_base, it.reading, it.own_cents, it.parity_cents, it.w
  on conflict (xray_id, xray_item_id) do nothing;

  -- M1-12 for the menu and per category; the change over the items scored in both runs of the monitoring.
  select px.id into prev from public.xray px
   where x.monitor_id is not null and px.monitor_id = x.monitor_id and px.id <> p_xray and px.created_at < x.created_at
     and exists (select 1 from public.xray_item_position q where q.xray_id = px.id and q.score_version = app.score_version_m1_12())
   order by px.created_at desc limit 1;
  with s as (
    select p.public_menu_item_id as item, p.item_category, p.score_weight as w, p.reading, p.own_cents, p.parity_cents,
           p.captured_cents
      from public.xray_item_position p
     where p.xray_id = p_xray and p.score_version = app.score_version_m1_12() and p.reading is not null and p.score_weight > 0
  ), scopes as (
    select 'menu' as scope, s.* from s
    union all
    select s.item_category, s.* from s where s.item_category is not null
  ), old as (
    select q.public_menu_item_id as item, q.score_weight as w, q.parity_cents, q.captured_cents from public.xray_item_position q
     where q.xray_id = prev and q.score_version = app.score_version_m1_12() and q.reading is not null and q.score_weight > 0
  ), both_runs as (
    select sc.scope,
           100.0 * sum(sc.w * sc.captured_cents) / nullif(sum(sc.w * sc.parity_cents), 0) as now_score,
           100.0 * sum(o.w * o.captured_cents) / nullif(sum(o.w * o.parity_cents), 0) as old_score, count(*) as n
      from scopes sc join old o on o.item = sc.item group by sc.scope
  )
  insert into public.xray_menu_score (xray_id, scope, score, score_version, items, in_band, below, risk,
                                      price_gap_per_sale_cents, previous_xray_id, delta, delta_items)
  select p_xray, sc.scope,
         case when (sc.scope = 'menu' or count(*) >= min_score_items) and sum(sc.w * sc.parity_cents) > 0
              then round(100.0 * sum(sc.w * sc.captured_cents) / sum(sc.w * sc.parity_cents))::int end,
         app.score_version_m1_12(), count(*),
         count(*) filter (where sc.reading = 'na_media'), count(*) filter (where sc.reading = 'pode_subir'),
         count(*) filter (where sc.reading = 'nao_mexer'),
         coalesce(sum(sc.parity_cents - sc.own_cents) filter (where sc.reading = 'pode_subir'), 0),
         prev,
         case when sc.scope = 'menu' or count(*) >= min_score_items then
           (select (round(b.now_score) - round(b.old_score))::int from both_runs b where b.scope = sc.scope) end,
         (select b.n from both_runs b where b.scope = sc.scope)
    from scopes sc group by sc.scope
  on conflict (xray_id, scope) do nothing;

  drop table pos_items;
  drop table pos_comps;
end $$;

-- Same moment as M1-10: app.snapshot_xray inserts the run's xray_store_rank once, after the calculation.
create function app.positions_after_rank() returns trigger
language plpgsql security definer set search_path = '' as $$
declare xid uuid;
begin
  for xid in select distinct n.xray_id from new_rows n loop
    perform app.positions_xray(xid);
  end loop;
  return null;
end $$;
create trigger positions after insert on public.xray_store_rank
  referencing new table as new_rows for each statement execute function app.positions_after_rank();

-- Loaders -----------------------------------------------------------------------------------------------------------------

-- P23: the run's score with its components, and per category score and position.
create function public.monitor_positions(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (select * from public.xray where id = p_xray)
  select jsonb_build_object(
    'score', (select jsonb_build_object('score', s.score, 'items', s.items, 'in_band', s.in_band, 'below', s.below,
                                        'risk', s.risk, 'price_gap_per_sale_cents', s.price_gap_per_sale_cents,
                                        'version', s.score_version, 'delta', s.delta, 'delta_items', s.delta_items)
                from public.xray_menu_score s where s.xray_id = p_xray and s.scope = 'menu'),
    'store_position', (select jsonb_build_object('rank', r.rank, 'stores_ranked', r.stores_ranked, 'price_index', r.price_index)
                         from public.xray_store_rank r where r.xray_id = p_xray and r.is_target),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object(
        'group', c.cat,
        'score', (select jsonb_build_object('score', s.score, 'items', s.items, 'in_band', s.in_band, 'below', s.below,
                                            'risk', s.risk, 'price_gap_per_sale_cents', s.price_gap_per_sale_cents,
                                            'version', s.score_version, 'delta', s.delta, 'delta_items', s.delta_items)
                    from public.xray_menu_score s where s.xray_id = p_xray and s.scope = c.cat),
        'position', (select jsonb_build_object('rank', r.rank, 'stores_ranked', r.stores_ranked, 'price_index', r.price_index,
                                               'items_compared', r.items_compared)
                       from public.xray_category_rank r join x on r.public_store_id = x.target_store_id
                      where r.xray_id = p_xray and r.item_category = c.cat))
        order by app.monitor_group_order(c.cat)), '[]')
        from (select scope as cat from public.xray_menu_score where xray_id = p_xray and scope <> 'menu'
              union select item_category from public.xray_category_rank where xray_id = p_xray) c),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', p.xray_item_id, 'own_item_id', p.public_menu_item_id, 'category', p.item_category,
        'percentile', p.percentile, 'rank', p.rank, 'stores', p.stores, 'captured_cents', p.captured_cents, 'parity_cents', p.parity_cents) order by p.public_menu_item_id), '[]')
        from public.xray_item_position p where p.xray_id = p_xray)
  )
$$;

-- P24: per run, the score, the store position and per category score and position. series_from is the first run that has
-- them; earlier runs carry nulls.
create or replace function public.monitor_history(p_monitor uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with runs as (select x.* from public.xray x where x.monitor_id = p_monitor)
  select jsonb_build_object(
    'series_from', (select r.id from runs r where exists (select 1 from public.xray_menu_score s where s.xray_id = r.id)
                     order by r.created_at, r.id limit 1),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object(
      'xray_id', x.id, 'created_at', x.created_at, 'on', (x.collected_at at time zone 'America/Sao_Paulo')::date,
      'status', x.status,
      'stores_read', (select count(*) from public.public_store_snapshot s where s.xray_id = x.id and s.public_store_id <> x.target_store_id),
      'items_compared', (select count(*) from public.xray_item i where i.xray_id = x.id and i.parity_cents is not null and not i.skipped),
      'rank', r.rank, 'stores_ranked', r.stores_ranked, 'price_index', r.price_index,
      'score', (select s.score from public.xray_menu_score s where s.xray_id = x.id and s.scope = 'menu'),
      'score_version', (select s.score_version from public.xray_menu_score s where s.xray_id = x.id and s.scope = 'menu'),
      'delta', (select s.delta from public.xray_menu_score s where s.xray_id = x.id and s.scope = 'menu'),
      'delta_items', (select s.delta_items from public.xray_menu_score s where s.xray_id = x.id and s.scope = 'menu'),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object(
          'group', s.scope, 'score', s.score, 'items', s.items, 'delta', s.delta, 'delta_items', s.delta_items,
          'price_gap_per_sale_cents', s.price_gap_per_sale_cents, 'risk', s.risk,
          'rank', (select cr.rank from public.xray_category_rank cr
                    where cr.xray_id = x.id and cr.item_category = s.scope and cr.is_target),
          'stores_ranked', (select cr.stores_ranked from public.xray_category_rank cr
                             where cr.xray_id = x.id and cr.item_category = s.scope and cr.is_target))
          order by app.monitor_group_order(s.scope)), '[]')
          from public.xray_menu_score s where s.xray_id = x.id and s.scope <> 'menu'))
      order by x.created_at, x.id), '[]')
      from runs x left join public.xray_store_rank r on r.xray_id = x.id and r.is_target)
  )
$$;

-- P24 chosen item: per calculated run, own price, parity, reading, category and its percentile and rank.
create or replace function public.monitor_item_history(p_monitor uuid, p_item uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'xray_id', x.id, 'on', (x.collected_at at time zone 'America/Sao_Paulo')::date,
    'own_cents', coalesce(sn.price_cents, case when i.id is not null then v.own_cents end),
    'parity_cents', i.parity_cents, 'reading', i.reading, 'category', i.item_category,
    'percentile', p.percentile, 'rank', p.rank, 'stores', p.stores, 'captured_cents', p.captured_cents)
    order by x.created_at, x.id), '[]')
    from public.xray x
    left join public.public_menu_item_snapshot sn on sn.xray_id = x.id and sn.public_menu_item_id = p_item
    left join public.xray_item i on i.xray_id = x.id and i.public_menu_item_id = p_item
    left join public.xray_item_view v on v.id = i.id
    left join public.xray_item_position p on p.xray_id = x.id and p.xray_item_id = i.id
   where x.monitor_id = p_monitor and x.status in ('ready', 'delivered')
$$;

revoke all on function app.positions_xray(uuid) from public, anon, authenticated;

revoke all on function app.positions_after_rank() from public, anon, authenticated;
revoke all on function public.monitor_positions(uuid) from public, anon, authenticated;
grant execute on function public.monitor_positions(uuid) to service_role;
