-- M1-12 v4 "Itens alinhados" (Marlon, 11/nov, D83): one definition for every screen. v3 counted only items with an exact
-- comparison (on a burger shop, the drinks). v4 counts them with the dishes compared by range (M1-13): an exact item is
-- aligned when its reading is na_media, a dish when it sits inside its range. Combos (M1-14, a different measure) and
-- items with no comparison stay out. Below and above keep their meaning: pode_subir or under the range, nao_mexer or over
-- it. The price gap per sale stays on the exact items, the only ones with a middle.
-- Values are never rewritten: a run keeps its v3 rows and gets v4 rows beside them, and every loader shows the current
-- version (app.score_version_m1_12), so the timeline, the history, the list and the result read the same number.

alter table public.xray_menu_score drop constraint xray_menu_score_xray_id_scope_key;
alter table public.xray_menu_score add constraint xray_menu_score_xray_scope_version_key unique (xray_id, scope, score_version);

create or replace function app.score_version_m1_12() returns text language sql immutable set search_path = '' as $$ select 'm1-12.v4' $$;

-- The items a run scores, one row each: the exact items' readings and the range dishes' positions in the same words.
create function app.score_items_m1_12(p_xray uuid)
returns table (item uuid, item_category text, reading public.xray_reading, own_cents bigint, parity_cents bigint)
language sql stable security definer set search_path = '' as $$
  select distinct on (p.public_menu_item_id) p.public_menu_item_id, p.item_category, p.reading, p.own_cents, p.parity_cents
    from public.xray_item_position p where p.xray_id = p_xray and p.reading is not null
  union all
  select i.public_menu_item_id, i.item_category,
         (case i.range_position when 'dentro' then 'na_media' when 'abaixo' then 'pode_subir' else 'nao_mexer' end)::public.xray_reading,
         null, null
    from public.xray_item i
   where i.xray_id = p_xray and i.comparison_tier = 'faixa' and i.combo_solo_cents is null and i.range_position is not null
     and not exists (select 1 from public.xray_item_position p where p.xray_id = p_xray and p.xray_item_id = i.id)
$$;

create function app.menu_score_m1_12(p_xray uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  min_score_items int := app.monitor_param('m1.score_min_items', 5)::int;
  prev uuid;
begin
  select * into x from public.xray where id = p_xray;
  if not found or exists (select 1 from public.xray_menu_score s where s.xray_id = p_xray and s.score_version = app.score_version_m1_12()) then
    return;
  end if;
  select px.id into prev from public.xray px
   where x.monitor_id is not null and px.monitor_id = x.monitor_id and px.id <> p_xray and px.created_at < x.created_at
     and exists (select 1 from public.xray_menu_score q where q.xray_id = px.id and q.score_version = app.score_version_m1_12())
   order by px.created_at desc limit 1;
  with s as (
    select t.*, app.score_aligned_m1_12(t.reading) as aligned from app.score_items_m1_12(p_xray) t
  ), scopes as (
    select 'menu' as scope, s.* from s
    union all
    select s.item_category, s.* from s where s.item_category is not null
  ), old as (
    select t.item, app.score_aligned_m1_12(t.reading) as aligned from app.score_items_m1_12(prev) t where prev is not null
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
         coalesce(sum(sc.parity_cents - sc.own_cents) filter (where sc.reading = 'pode_subir' and sc.parity_cents is not null), 0),
         prev,
         case when sc.scope = 'menu' or count(*) >= min_score_items then
           (select (round(b.now_score) - round(b.old_score))::int from both_runs b where b.scope = sc.scope) end,
         (select b.n from both_runs b where b.scope = sc.scope)
    from scopes sc group by sc.scope
  on conflict (xray_id, scope, score_version) do nothing;
end $$;

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

  -- M1-12 v4 (D83): exact items and range dishes together, in its own function.
  perform app.menu_score_m1_12(p_xray);

  drop table pos_items;
  drop table pos_comps;
end $$;

revoke all on function app.score_items_m1_12(uuid) from public, anon, authenticated;
revoke all on function app.menu_score_m1_12(uuid) from public, anon, authenticated;
revoke all on function app.positions_xray(uuid) from public, anon, authenticated;

-- Every calculated run gets its v4 score, oldest first so each one finds its previous run.
do $$
declare r record;
begin
  for r in select x.id from public.xray x
            where exists (select 1 from public.xray_item_position p where p.xray_id = x.id)
               or exists (select 1 from public.xray_item i where i.xray_id = x.id and i.range_position is not null)
            order by x.created_at, x.id
  loop
    perform app.menu_score_m1_12(r.id);
  end loop;
end $$;
