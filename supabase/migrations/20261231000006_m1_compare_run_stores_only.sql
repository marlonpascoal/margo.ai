-- A run compares only with the stores it read (Marlon, 08/nov). With the capture cap (D47d, 30 per X-ray) a run reads
-- its capture slots, but pairing took every included store with a menu in the catalog, so stores read by another X-ray
-- of the same area entered too: a run that read 30 stores ranked the target among 74 ("cobra menos que 19 das 73").
-- app.xray_compared_store_ids is the one definition: the included stores in the run's capture slots, or every included
-- store when the run has no slot (runs from before the cap, extraction off, the G-SYN seed). Pairing (worker
-- xray_pair), "Comparamos com as N lojas" (monitor_result) and "Lojas lidas" (monitor_history) use it. Runs already
-- calculated keep their pairs until they are paired again.

create function app.xray_compared_store_ids(p_xray uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select xs.public_store_id from public.xray_store xs join public.xray x on x.id = xs.xray_id
   where xs.xray_id = p_xray and xs.included and xs.public_store_id <> x.target_store_id
     and (xs.capture_slot or not exists (select 1 from public.xray_store s where s.xray_id = p_xray and s.capture_slot))
$$;
revoke all on function app.xray_compared_store_ids(uuid) from public, anon, authenticated;
grant execute on function app.xray_compared_store_ids(uuid) to service_role;

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
    'stores_compared', (select count(*) from app.xray_compared_store_ids(x.id)),
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
      'stores_read', (select count(*) from app.xray_compared_store_ids(x.id)),
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
