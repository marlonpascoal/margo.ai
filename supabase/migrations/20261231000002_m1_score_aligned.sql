-- M1-12 v3 "% de itens alinhados" (Marlon, 07/nov), replacing v2 "score de preço" (share of the neighborhood price),
-- which sat near 98 on real menus and barely moved. Over the items of a run with an M1-07 reading (same items as before),
-- for the menu and per category:
--   score = round(100 x items read na_media / items with a reading), counting items, not weighted by weekly units.
-- Beside it, unchanged: in_band, below (pode_subir), risk (nao_mexer), and the price gap per sale of the items below.
-- The change against the previous run still covers only the items scored in both, by the same formula version.
-- Values are never rewritten: runs scored by v2 keep their rows, and the loaders show only the current version, so a
-- line never mixes formulas (those runs read "sem score").

create or replace function app.score_version_m1_12() returns text language sql immutable set search_path = '' as $$ select 'm1-12.v3' $$;

-- M1-12 v3, the one place the item rule lives: 1 when the item sits in the neighborhood band.
create function app.score_aligned_m1_12(p_reading public.xray_reading) returns int
language sql immutable set search_path = '' as $$
  select case when p_reading = 'na_media' then 1 else 0 end
$$;

create or replace function app.positions_xray(p_xray uuid) returns void
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

  -- Product position, with the item's inputs (captured_cents kept as before, no longer in the score).
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

  -- M1-12 v3 for the menu and per category; the change over the items scored in both runs of the monitoring.
  select px.id into prev from public.xray px
   where x.monitor_id is not null and px.monitor_id = x.monitor_id and px.id <> p_xray and px.created_at < x.created_at
     and exists (select 1 from public.xray_item_position q where q.xray_id = px.id and q.score_version = app.score_version_m1_12())
   order by px.created_at desc limit 1;
  with s as (
    select p.public_menu_item_id as item, p.item_category, p.reading, p.own_cents, p.parity_cents,
           app.score_aligned_m1_12(p.reading) as aligned
      from public.xray_item_position p
     where p.xray_id = p_xray and p.score_version = app.score_version_m1_12() and p.reading is not null
  ), scopes as (
    select 'menu' as scope, s.* from s
    union all
    select s.item_category, s.* from s where s.item_category is not null
  ), old as (
    select q.public_menu_item_id as item, app.score_aligned_m1_12(q.reading) as aligned from public.xray_item_position q
     where q.xray_id = prev and q.score_version = app.score_version_m1_12() and q.reading is not null
  ), both_runs as (
    select sc.scope, 100.0 * avg(sc.aligned) as now_score, 100.0 * avg(o.aligned) as old_score, count(*) as n
      from scopes sc join old o on o.item = sc.item group by sc.scope
  )
  insert into public.xray_menu_score (xray_id, scope, score, score_version, items, in_band, below, risk,
                                      price_gap_per_sale_cents, previous_xray_id, delta, delta_items)
  select p_xray, sc.scope,
         case when sc.scope = 'menu' or count(*) >= min_score_items then round(100.0 * avg(sc.aligned))::int end,
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
revoke all on function app.positions_xray(uuid) from public, anon, authenticated;
revoke all on function app.score_aligned_m1_12(public.xray_reading) from public, anon, authenticated;

comment on table public.xray_menu_score is
  'M1-12 "% de itens alinhados" (v3): share of the compared items in the neighborhood band, 0 to 100 of a run, scope ''menu'' or an M1-04 category, with the counts below and above and the price gap per sale. Rows of older versions are kept and not shown. Never updated.';

-- Loaders: only the current formula version, so a line never mixes formulas.
create or replace function public.monitor_positions(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (select * from public.xray where id = p_xray),
  sc as (select * from public.xray_menu_score s where s.xray_id = p_xray and s.score_version = app.score_version_m1_12())
  select jsonb_build_object(
    'score', (select jsonb_build_object('score', s.score, 'items', s.items, 'in_band', s.in_band, 'below', s.below,
                                        'risk', s.risk, 'price_gap_per_sale_cents', s.price_gap_per_sale_cents,
                                        'version', s.score_version, 'delta', s.delta, 'delta_items', s.delta_items)
                from sc s where s.scope = 'menu'),
    'store_position', (select jsonb_build_object('rank', r.rank, 'stores_ranked', r.stores_ranked, 'price_index', r.price_index)
                         from public.xray_store_rank r where r.xray_id = p_xray and r.is_target),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object(
        'group', c.cat,
        'score', (select jsonb_build_object('score', s.score, 'items', s.items, 'in_band', s.in_band, 'below', s.below,
                                            'risk', s.risk, 'price_gap_per_sale_cents', s.price_gap_per_sale_cents,
                                            'version', s.score_version, 'delta', s.delta, 'delta_items', s.delta_items)
                    from sc s where s.scope = c.cat),
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

create or replace function public.monitor_history(p_monitor uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with runs as (select x.* from public.xray x where x.monitor_id = p_monitor),
  sc as (select s.* from public.xray_menu_score s join runs r on r.id = s.xray_id where s.score_version = app.score_version_m1_12())
  select jsonb_build_object(
    'series_from', (select r.id from runs r where exists (select 1 from public.xray_menu_score s where s.xray_id = r.id)
                     order by r.created_at, r.id limit 1),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object(
      'xray_id', x.id, 'created_at', x.created_at, 'on', (x.collected_at at time zone 'America/Sao_Paulo')::date,
      'status', x.status,
      'stores_read', (select count(*) from public.public_store_snapshot s where s.xray_id = x.id and s.public_store_id <> x.target_store_id),
      'items_compared', (select count(*) from public.xray_item i where i.xray_id = x.id and i.parity_cents is not null and not i.skipped),
      'rank', r.rank, 'stores_ranked', r.stores_ranked, 'price_index', r.price_index,
      'score', (select s.score from sc s where s.xray_id = x.id and s.scope = 'menu'),
      'score_version', (select s.score_version from sc s where s.xray_id = x.id and s.scope = 'menu'),
      'delta', (select s.delta from sc s where s.xray_id = x.id and s.scope = 'menu'),
      'delta_items', (select s.delta_items from sc s where s.xray_id = x.id and s.scope = 'menu'),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object(
          'group', s.scope, 'score', s.score, 'items', s.items, 'delta', s.delta, 'delta_items', s.delta_items,
          'price_gap_per_sale_cents', s.price_gap_per_sale_cents, 'risk', s.risk,
          'rank', (select cr.rank from public.xray_category_rank cr
                    where cr.xray_id = x.id and cr.item_category = s.scope and cr.is_target),
          'stores_ranked', (select cr.stores_ranked from public.xray_category_rank cr
                             where cr.xray_id = x.id and cr.item_category = s.scope and cr.is_target))
          order by app.monitor_group_order(s.scope)), '[]')
          from sc s where s.xray_id = x.id and s.scope <> 'menu'))
      order by x.created_at, x.id), '[]')
      from runs x left join public.xray_store_rank r on r.xray_id = x.id and r.is_target)
  )
$$;
revoke all on function public.monitor_positions(uuid) from public, anon, authenticated;
grant execute on function public.monitor_positions(uuid) to service_role;
