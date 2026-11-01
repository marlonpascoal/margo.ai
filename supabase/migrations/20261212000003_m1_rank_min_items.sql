-- M1-10 ranking only among comparable stores (Marlon, 31/out): a neighbor store is ranked only when at least
-- m1.rank_min_items (param, 3) of the target's items were compared with it, so a store matched on one or two
-- items does not take a place in "ranking geral da loja". The target is always ranked when it has items.
-- Replaces app.snapshot_xray of 20261105000010; everything else in it is unchanged. Rankings already written
-- are never rewritten (xray_store_rank is immutable, and a run is ranked only once).

insert into public.rule_param (key, value, description) values
  ('m1.rank_min_items', 3, 'M1-10: a neighbor store is ranked only with at least this many items compared with the target');

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
  select p_xray, i.public_store_id, i.id, i.name, i.price_cents, i.unit, i.unit_qty, at
    from public.public_menu_item i
   where i.public_store_id = x.target_store_id
      or i.public_store_id in (select xs.public_store_id from public.xray_store xs
                                where xs.xray_id = p_xray and xs.included)
  on conflict (xray_id, public_menu_item_id) do nothing;

  -- M1-10 only once the run is calculated, and only once per run. A neighbor needs m1.rank_min_items
  -- compared items; the target is ranked whenever it has one.
  min_items := coalesce((select p.value::int from public.rule_param p where p.key = 'm1.rank_min_items'), 3);
  if exists (select 1 from public.xray_item xi where xi.xray_id = p_xray and xi.parity_cents is not null)
     and not exists (select 1 from public.xray_store_rank r where r.xray_id = p_xray) then
    with items as (
      select xi.id, own.public_store_id as own_store,
             app.per_base_m1_03(own.price_cents, own.unit, own.unit_qty) as own_base
        from public.xray_item xi
        join public.public_menu_item own on own.id = xi.public_menu_item_id
       where xi.xray_id = p_xray and xi.parity_cents is not null and not xi.skipped
    ), comps as (
      select it.id as item_id, c.public_store_id,
             app.per_base_m1_03(c.price_cents, c.unit, c.unit_qty) as base
        from items it
        join public.xray_pair p on p.xray_item_id = it.id and p.accepted
        join public.public_menu_item c on c.id = p.public_menu_item_id
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

comment on table public.xray_store_rank is
  'M1-10 (proposed): price index = median over the target''s analyzed items of (store normalized price / median normalized price of the accepted comparables); only stores with at least m1.rank_min_items compared items are ranked, the target always; rank 1 = lowest index. Never updated.';
