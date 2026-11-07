-- Removed items and the M1-05 comparison price (D47c, docs/extract-api.md).
-- app.snapshot_xray ignores removed items and uses public_menu_item.comparison_price_cents. Everything else in it
-- is as in 20261212000003; rows already written are never rewritten.
-- xray_item_view shows the price of the run (its snapshot) when there is one: weekly captures move the catalog
-- and must not change the numbers of a calculated or delivered X-ray.

create or replace function app.snapshot_xray(p_xray uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  at timestamptz;
  min_items int;
begin
  select * into x from public.xray where id = p_xray;
  if not found then
    raise exception 'unknown X-ray %', p_xray using errcode = 'no_data_found';
  end if;
  at := coalesce(x.collected_at, now());

  insert into public.public_store_snapshot (xray_id, public_store_id, name, area, category, is_national_chain,
                                            last_seen_open_at, collected_at)
  select p_xray, ps.id, ps.name, ps.area, ps.category, ps.is_national_chain, ps.last_seen_open_at, at
    from public.public_store ps
   where ps.id = x.target_store_id
      or ps.id in (select xs.public_store_id from public.xray_store xs where xs.xray_id = p_xray)
  on conflict (xray_id, public_store_id) do nothing;

  insert into public.public_menu_item_snapshot (xray_id, public_store_id, public_menu_item_id, name, price_cents,
                                                unit, unit_qty, collected_at)
  select p_xray, i.public_store_id, i.id, i.name, i.comparison_price_cents, i.unit, i.unit_qty, at
    from public.public_menu_item i
   where i.removed_at is null
     and (i.public_store_id = x.target_store_id
          or i.public_store_id in (select xs.public_store_id from public.xray_store xs
                                    where xs.xray_id = p_xray and xs.included))
  on conflict (xray_id, public_menu_item_id) do nothing;

  -- M1-10 only once the run is calculated, and only once per run. A neighbor needs m1.rank_min_items
  -- compared items; the target is ranked whenever it has one.
  min_items := coalesce((select p.value::int from public.rule_param p where p.key = 'm1.rank_min_items'), 3);
  if exists (select 1 from public.xray_item xi where xi.xray_id = p_xray and xi.parity_cents is not null)
     and not exists (select 1 from public.xray_store_rank r where r.xray_id = p_xray) then
    with items as (
      select xi.id, own.public_store_id as own_store,
             app.per_base_m1_03(own.comparison_price_cents, own.unit, own.unit_qty) as own_base
        from public.xray_item xi
        join public.public_menu_item own on own.id = xi.public_menu_item_id
       where xi.xray_id = p_xray and xi.parity_cents is not null and not xi.skipped and own.removed_at is null
    ), comps as (
      select it.id as item_id, c.public_store_id,
             app.per_base_m1_03(c.comparison_price_cents, c.unit, c.unit_qty) as base
        from items it
        join public.xray_pair p on p.xray_item_id = it.id and p.accepted
        join public.public_menu_item c on c.id = p.public_menu_item_id and c.removed_at is null
    ), med as (
      select item_id, percentile_cont(0.5) within group (order by base) as m
        from comps group by item_id having percentile_cont(0.5) within group (order by base) > 0
    ), ratios as (
      select it.own_store as store, it.id as item_id, it.own_base / med.m as ratio
        from items it join med on med.item_id = it.id
      union all
      select c.public_store_id, c.item_id, avg(c.base) / med.m
        from comps c join med on med.item_id = c.item_id
       group by c.public_store_id, c.item_id, med.m
    ), idx as (
      select store, round(percentile_cont(0.5) within group (order by ratio)::numeric, 4) as price_index,
             count(*)::int as n
        from ratios group by store
    )
    insert into public.xray_store_rank (xray_id, public_store_id, is_target, price_index, items_compared, rank, stores_ranked)
    select p_xray, store, store = x.target_store_id, greatest(price_index, 0.0001), n,
           rank() over (order by price_index), count(*) over ()
      from idx
     where store = x.target_store_id or n >= min_items;
  end if;
end $$;

create or replace view public.xray_item_view with (security_invoker = true) as
select
  i.id,
  i.xray_id,
  i.public_menu_item_id,
  m.name,
  coalesce(sn.price_cents, m.comparison_price_cents) as own_cents,
  m.unit,
  m.unit_qty,
  i.norm_unit,
  i.norm_price_cents,
  i.parity_cents,
  i.gap_pct,
  i.loss_cents,
  i.reading,
  i.pair_status,
  i.pair_note,
  i.weekly_units,
  i.reviewed_at,
  i.skipped,
  i.pareto_rank,
  i.pareto_cum_share,
  (select count(*) from public.xray_pair p where p.xray_item_id = i.id)::int as comparables,
  (select count(*) from public.xray_pair p where p.xray_item_id = i.id and p.accepted)::int as accepted_pairs,
  ex.name as example_name,
  ex.price_cents as example_cents
from public.xray_item i
join public.public_menu_item m on m.id = i.public_menu_item_id
left join public.public_menu_item_snapshot sn on sn.xray_id = i.xray_id and sn.public_menu_item_id = m.id
left join lateral (
  select pm.name, coalesce(psn.price_cents, pm.comparison_price_cents) as price_cents
  from public.xray_pair p join public.public_menu_item pm on pm.id = p.public_menu_item_id
  left join public.public_menu_item_snapshot psn on psn.xray_id = i.xray_id and psn.public_menu_item_id = pm.id
  where p.xray_item_id = i.id
  order by p.accepted desc, p.similarity desc, pm.name, pm.id
  limit 1
) ex on true;
