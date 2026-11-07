-- M1 dual parity (Marlon, 07/nov; 04 M1-05 to M1-08): promotions are evaluated at the current and at the full price
-- (original_price_cents when present, else the current price), and the reading takes the more cautious one.
--   xray_item.parity_full_cents, gap_full_pct   M1-05, M1-06 at full prices. parity_cents, gap_pct keep meaning current
--   xray_item.full_price_room                   M1-07: the note of a `na_media` item with room at full prices
--   public_menu_item_snapshot.full_price_cents  the run's full price; null means the current price of that run
-- Existing rows are not recomputed: a null full parity shows no secondary information, and old snapshots stay as they
-- are (the immutable triggers of the M1 history migration fire on row changes, not on this column).
-- app.snapshot_xray is as in the M1 removed-items migration except for the new column; M1-10 stays on current prices.

alter table public.xray_item
  add column parity_full_cents bigint,
  add column gap_full_pct numeric(7, 4),
  add column full_price_room boolean not null default false;
comment on column public.xray_item.parity_cents is 'M1-05: parity at current prices. M1-08 and M1-09 use this one only.';
comment on column public.xray_item.parity_full_cents is
  'M1-05: parity at full prices over the same accepted items. Null: calculated before dual parity, no secondary information.';
comment on column public.xray_item.gap_full_pct is 'M1-06: own full price against parity_full_cents.';
comment on column public.xray_item.full_price_room is
  'M1-07: reading is na_media and the full-price gap is at or below minus the band.';

alter table public.public_menu_item_snapshot
  add column full_price_cents bigint check (full_price_cents is null or full_price_cents > 0);
comment on column public.public_menu_item_snapshot.full_price_cents is
  'M1-05: the full price in this run (the original price before a promotion). Null means price_cents, also in every run from before dual parity.';

comment on column public.public_menu_item.original_price_cents is
  'Price before a promotion. M1-05: the full price of the item; a recalculation reads the copy in the run''s snapshot, not this one.';

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
                                                full_price_cents, unit, unit_qty, collected_at)
  select p_xray, i.public_store_id, i.id, i.name, i.comparison_price_cents, nullif(i.original_price_cents, 0),
         i.unit, i.unit_qty, at
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

-- The new columns go last, as create or replace view requires.
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
  ex.price_cents as example_cents,
  i.parity_full_cents,
  i.gap_full_pct,
  i.full_price_room
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
