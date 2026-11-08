-- Prices shown per the owner's unit now honor the M1-04 default sizes (20261229000003). A neighbor "lata" with no size
-- in its name is paired as 350 ml (xray_pair.size_presumed_ml), but "Ver as lojas", the P23 price strip and the
-- competitor head-to-head read its whole price as a price per ml and multiplied it by the owner's 350 ml: R$ 8,00 showed
-- as R$ 2.800 (Marlon, 08/nov). The other way round, an owner "Água, unidade" presumed 500 ml showed neighbors per 1 ml.
-- Parity, readings, loss and the score were right: the Python calculation already used the presumed sizes.
-- app.own_unit_price_m1_03 is the one place the conversion lives; the three loaders are the 20261231000001 ones with it.

-- M1-03: a comparable's price in the owner's unit. Each side takes its presumed size when the pairing recorded one.
create function app.own_unit_price_m1_03(p_price bigint, p_unit public.menu_unit, p_qty numeric, p_presumed_ml numeric,
                                         p_own_unit public.menu_unit, p_own_qty numeric, p_own_presumed_ml numeric)
returns numeric language sql immutable set search_path = '' as $$
  -- Same divisor as app.per_base_m1_03 (a combo compares whole), multiplied first so equal sizes stay exact.
  select p_price::numeric * coalesce(p_own_presumed_ml, p_own_qty, 1)
         / case when p_presumed_ml is not null then p_presumed_ml
                when p_unit = 'pack' and p_qty is null then 1
                else coalesce(p_qty, 1) end
$$;
revoke all on function app.own_unit_price_m1_03(bigint, public.menu_unit, numeric, numeric, public.menu_unit, numeric, numeric)
  from public, anon, authenticated;

create or replace function public.monitor_result_stores(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with rows as (
    select i.id as item_id, pm.public_store_id,
           round(app.own_unit_price_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty,
                                        p.size_presumed_ml, om.unit, om.unit_qty, i.size_presumed_ml))::bigint as price
      from public.xray_item i
      join public.public_menu_item om on om.id = i.public_menu_item_id
      join public.xray_pair p on p.xray_item_id = i.id and p.accepted
      join public.public_menu_item pm on pm.id = p.public_menu_item_id
      left join public.public_menu_item_snapshot sn on sn.xray_id = p_xray and sn.public_menu_item_id = pm.id
     where i.xray_id = p_xray and not i.skipped and i.parity_cents is not null
  ),
  per_store as (
    select item_id, public_store_id, min(price) as price from rows group by item_id, public_store_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('item_id', g.item_id, 'stores', g.stores)), '[]')
    from (select s.item_id,
                 jsonb_agg(jsonb_build_object('name', coalesce(app.monitor_store_label(p_xray, s.public_store_id), 'Loja'),
                                              'price_cents', s.price)
                           order by s.price, app.monitor_store_label(p_xray, s.public_store_id) collate "C") as stores
            from per_store s group by s.item_id) g
$$;

create or replace function public.monitor_head_to_head(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (select * from public.xray where id = p_xray and target_kind = 'competitor'),
  own_runs as (
    select distinct on (m.id) r.id, r.target_store_id, r.collected_at
      from x join public.xray_monitor m on m.account_id = x.account_id and m.target_kind = 'own' and m.status <> 'removed'
      join public.xray r on r.monitor_id = m.id and r.status in ('ready', 'delivered')
     where exists (select 1 from public.xray_store xs where xs.xray_id = r.id and xs.public_store_id = x.target_store_id)
     order by m.id, r.created_at desc
  ),
  pairs as (
    select o.id as run_id, i.id as item_id, v.name, v.own_cents,
           app.monitor_item_group(i.item_category, v.comparables) as grp,
           min(round(app.own_unit_price_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty,
                                            p.size_presumed_ml, om.unit, om.unit_qty, i.size_presumed_ml)))::bigint as their_cents
      from own_runs o
      join x on true
      join public.xray_item i on i.xray_id = o.id
      join public.xray_item_view v on v.id = i.id
      join public.public_menu_item om on om.id = i.public_menu_item_id
      join public.xray_pair p on p.xray_item_id = i.id and p.accepted
      join public.public_menu_item pm on pm.id = p.public_menu_item_id and pm.public_store_id = x.target_store_id
      left join public.public_menu_item_snapshot sn on sn.xray_id = o.id and sn.public_menu_item_id = pm.id
     group by o.id, i.id, v.name, v.own_cents, i.item_category, v.comparables
  ),
  best as (
    select o.id, o.target_store_id, o.collected_at from own_runs o
      join (select run_id, count(*) as n from pairs group by run_id) c on c.run_id = o.id
     order by c.n desc, o.collected_at desc limit 1
  )
  select jsonb_build_object(
    'own_xray_id', b.id,
    'own_store_name', coalesce((select s.name from public.public_store s where s.id = b.target_store_id), 'Loja'),
    'on', (b.collected_at at time zone 'America/Sao_Paulo')::date,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('item_id', p.item_id, 'name', p.name, 'own_cents', p.own_cents,
                                                           'their_cents', p.their_cents, 'group', p.grp)
                                        order by app.monitor_group_order(p.grp), p.their_cents - p.own_cents, p.name collate "C"), '[]')
                from pairs p where p.run_id = b.id))
    from best b
$$;

create or replace function public.monitor_result(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (
    select v.*, s.name as store_name, coalesce(a.is_synthetic, false) as synthetic
      from public.xray v join public.public_store s on s.id = v.target_store_id
      left join public.account a on a.id = v.account_id where v.id = p_xray
  ),
  it as (
    select i.id, v.name, v.own_cents, i.parity_cents, i.gap_pct, i.reading, i.loss_cents, i.skipped, i.pareto_rank,
           i.pareto_cum_share, i.parity_full_cents, i.gap_full_pct, i.full_price_room, i.public_menu_item_id,
           not i.skipped and i.parity_cents is not null as analyzed, i.item_category,
           app.monitor_item_group(i.item_category, case when i.pair_status = 'exclusivo' then 0 else v.comparables end) as grp,
           greatest(coalesce(i.gap_pct, 0), coalesce(i.gap_full_pct, coalesce(i.gap_pct, 0))) as highest_gap
      from public.xray_item i join public.xray_item_view v on v.id = i.id where i.xray_id = p_xray
  ),
  strip as (
    select p.xray_item_id,
           min(app.own_unit_price_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty,
                                   p.size_presumed_ml, om.unit, om.unit_qty, i.size_presumed_ml)) as low,
           max(app.own_unit_price_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty,
                                   p.size_presumed_ml, om.unit, om.unit_qty, i.size_presumed_ml)) as high,
           count(distinct pm.public_store_id) as stores
      from public.xray_pair p join public.xray_item i on i.id = p.xray_item_id
      join public.public_menu_item om on om.id = i.public_menu_item_id
      join public.public_menu_item pm on pm.id = p.public_menu_item_id
      left join public.public_menu_item_snapshot sn on sn.xray_id = p_xray and sn.public_menu_item_id = pm.id
     where i.xray_id = p_xray and p.accepted
     group by p.xray_item_id
  ),
  up as (
    select * from it where analyzed and reading = 'pode_subir'
     order by coalesce(loss_cents, 0) desc, name collate "C" limit 3
  ),
  rank_now as (select r.* from public.xray_store_rank r join x on x.id = r.xray_id and r.is_target),
  prev as (
    select v.id from public.xray v join x on v.monitor_id = x.monitor_id
     where v.id <> x.id and v.created_at < x.created_at and v.status in ('ready', 'delivered')
     order by v.created_at desc limit 1
  ),
  rank_prev as (select r.* from public.xray_store_rank r join prev on prev.id = r.xray_id and r.is_target),
  caps as (select * from app.monitor_capture_rows(p_xray)),
  item_json as (
    select it.*, jsonb_build_object(
      'item_id', it.id, 'name', it.name, 'own_cents', it.own_cents, 'parity_cents', it.parity_cents,
      'gap_pct', it.gap_pct, 'reading', it.reading, 'loss_cents', it.loss_cents,
      'parity_full_cents', it.parity_full_cents, 'gap_full_pct', it.gap_full_pct, 'full_price_room', it.full_price_room,
      'pareto_rank', it.pareto_rank, 'pareto_cum_share', it.pareto_cum_share,
      'low_cents', round(s.low)::bigint, 'high_cents', round(s.high)::bigint, 'stores', s.stores,
      'category', it.item_category, 'group', it.grp) as j
      from it left join strip s on s.xray_item_id = it.id
  )
  select jsonb_build_object(
    'xray_id', x.id, 'monitor_id', x.monitor_id, 'status', x.status, 'target_kind', x.target_kind,
    'store_name', coalesce(x.store_name, 'Loja'), 'synthetic', x.synthetic,
    -- Cache key of a printed copy: the run row changes on every status step, the items on every calculation.
    'version', md5(x.updated_at::text || coalesce((select max(i.updated_at)::text from public.xray_item i where i.xray_id = x.id), '')),
    'on', (x.collected_at at time zone 'America/Sao_Paulo')::date, 'created_at', x.created_at,
    'radius_km', x.radius_km,
    'reading_band', coalesce((x.rules ->> 'reading_band')::numeric, 0.1),
    'stores_compared', (select count(*) from public.xray_store xs where xs.xray_id = x.id and xs.included),
    'items_total', (select count(*) from it),
    'items_analyzed', (select count(*) from it where analyzed),
    'below', (select count(*) from it where analyzed and reading = 'pode_subir'),
    'above', (select count(*) from it where analyzed and reading = 'nao_mexer'),
    'top_raise', (select coalesce(jsonb_agg(j.j order by j.gap_pct, j.name collate "C"), '[]')
                    from item_json j where j.id in (select id from up)),
    'dont_lower', (select coalesce(jsonb_agg(j.j order by j.highest_gap desc, j.name collate "C"), '[]')
                     from item_json j where j.analyzed and j.reading = 'nao_mexer'),
    'items', (select coalesce(jsonb_agg(j.j order by case j.reading when 'pode_subir' then 0 when 'na_media' then 1 else 2 end,
                                         abs(coalesce(j.gap_pct, 0)) desc, j.name collate "C"), '[]')
                from item_json j where j.analyzed),
    -- Per category (Marlon, 07/nov): items in the group, items compared, can go up, leave alone, and the price gap per
    -- sale ("diferença de preço por venda"): the sum of (parity minus own price) over the pode_subir items. No cost, no volume.
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object(
        'group', g.grp, 'items', g.n, 'items_compared', g.compared, 'can_go_up', g.up, 'leave_alone', g.hold,
        'at_average', g.avg, 'price_gap_per_sale_cents', g.price_gap) order by app.monitor_group_order(g.grp)), '[]')
        from (select grp, count(*) as n, count(*) filter (where analyzed) as compared,
                     count(*) filter (where analyzed and reading = 'pode_subir') as up,
                     count(*) filter (where analyzed and reading = 'nao_mexer') as hold,
                     count(*) filter (where analyzed and reading = 'na_media') as avg,
                     coalesce(sum(parity_cents - own_cents) filter (where analyzed and reading = 'pode_subir'), 0)::bigint as price_gap
                from it group by grp) g),
    'pareto_count', coalesce((select pareto_rank from it where pareto_rank is not null and pareto_cum_share >= 0.8
                               order by pareto_rank limit 1), 0),
    'left_out_items', (select coalesce(jsonb_agg(name order by name collate "C"), '[]') from it where skipped),
    'method_note', 'Fonte: cardápios públicos no iFood. Paridade = mediana dos itens comparáveis em ' || x.radius_km
                   || ' km. Sem dado de custo.',
    'position', (select jsonb_build_object('rank', r.rank, 'stores_ranked', r.stores_ranked, 'price_index', r.price_index,
                                           'items_compared', r.items_compared) from rank_now r),
    'previous_position', (select jsonb_build_object('xray_id', r.xray_id, 'rank', r.rank, 'stores_ranked', r.stores_ranked)
                            from rank_prev r),
    'doubts_open', (select count(*) from public.xray_item i where i.xray_id = x.id and i.pair_status = 'revisar'
                      and i.reviewed_at is null and exists (select 1 from public.xray_pair p where p.xray_item_id = i.id)),
    'only_yours', (select count(*) from public.xray_item_view v where v.xray_id = x.id and (v.comparables = 0 or v.pair_status = 'exclusivo')),
    'stores_read', (select count(*) from caps where state = 'done' and not is_target),
    'stores_total', (select count(*) from caps where state <> 'beyond_cap' and not is_target),
    'stores_left_out', (select count(*) from caps where left_out and not is_target)
  ) from x
$$;
