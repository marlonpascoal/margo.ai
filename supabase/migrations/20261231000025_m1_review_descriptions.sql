-- P22 "Revisar" (Marlon, 10/nov): the items' descriptions help the owner tell whether two items are the same. The own
-- item and every candidate or accepted pair carry their menu description. Otherwise as in 20261231000001.

create or replace function public.monitor_doubts(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (select * from public.xray where id = p_xray),
  items as (
    select i.*, (select count(*) from public.xray_pair p where p.xray_item_id = i.id) as n_pairs,
           exists (select 1 from public.xray_pair p where p.xray_item_id = i.id and p.accepted) as any_accepted
      from public.xray_item i where i.xray_id = p_xray
  )
  select jsonb_build_object(
    'xray_id', p_xray,
    'asked', not ((select target_kind from x) = 'competitor' and app.monitor_param('m1.portal_competitor_doubts_asked', 0) = 0),
    'auto_confirmed', (select count(*) from items where pair_status <> 'revisar' and any_accepted),
    'open', (select count(*) from items where pair_status = 'revisar' and n_pairs > 0 and reviewed_at is null),
    'answered', (select count(*) from items where pair_status = 'revisar' and n_pairs > 0 and reviewed_at is not null),
    'only_yours', (select count(*) from items where n_pairs = 0 or pair_status = 'exclusivo'),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('group', g, 'open', o, 'answered', a)
                      order by app.monitor_group_order(g)), '[]')
                      from (select app.monitor_item_group(item_category, n_pairs) as g,
                                   count(*) filter (where reviewed_at is null) as o,
                                   count(*) filter (where reviewed_at is not null) as a
                              from items where pair_status = 'revisar' and n_pairs > 0 group by 1) c),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'own_item_id', i.public_menu_item_id, 'name', v.name, 'own_cents', v.own_cents,
        'description', (select om.description from public.public_menu_item om where om.id = i.public_menu_item_id),
        'category', i.item_category, 'group', app.monitor_item_group(i.item_category, i.n_pairs),
        'unit', v.unit, 'unit_qty', v.unit_qty, 'pair_note', i.pair_note, 'item_category', i.item_category,
        'answered', i.reviewed_at is not null, 'answered_at', i.reviewed_at,
        'answered_by', (select pe.name from public.person pe where pe.id = i.reviewed_by),
        'answered_by_staff', exists (select 1 from public.staff st where st.person_id = i.reviewed_by),
        'stores', (select count(distinct pm.public_store_id) from public.xray_pair p
                     join public.public_menu_item pm on pm.id = p.public_menu_item_id where p.xray_item_id = i.id),
        'candidates', (select coalesce(jsonb_agg(jsonb_build_object(
            'pair_id', p.id, 'name', pm.name, 'store', app.monitor_store_label(p_xray, pm.public_store_id),
            'description', pm.description,
            'price_cents', coalesce(sn.price_cents, pm.comparison_price_cents), 'unit', pm.unit, 'unit_qty', pm.unit_qty,
            'accepted', p.accepted, 'suggested', p.id = app.monitor_suggestion(i.id))
            order by p.similarity desc, pm.public_store_id, pm.id), '[]')
            from public.xray_pair p join public.public_menu_item pm on pm.id = p.public_menu_item_id
            left join public.public_menu_item_snapshot sn on sn.xray_id = p_xray and sn.public_menu_item_id = pm.id
           where p.xray_item_id = i.id))
        order by app.monitor_group_order(app.monitor_item_group(i.item_category, i.n_pairs)), i.reviewed_at nulls first,
                 v.name collate "C", i.id), '[]')
        from items i join public.xray_item_view v on v.id = i.id
       where i.pair_status = 'revisar' and i.n_pairs > 0)
  )
$$;

create or replace function public.monitor_items(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with v as (
    select v.*, i.item_category, app.monitor_item_group(i.item_category, case when v.pair_status = 'exclusivo' then 0 else v.comparables end) as grp
      from public.xray_item_view v join public.xray_item i on i.id = v.id where v.xray_id = p_xray
  ),
  conf as (select * from v where v.accepted_pairs > 0 and (v.pair_status <> 'revisar' or v.reviewed_at is not null))
  select jsonb_build_object(
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('group', g, 'only_yours', o, 'confirmed', c)
                      order by app.monitor_group_order(g)), '[]')
                      from (select grp as g, count(*) filter (where comparables = 0 or pair_status = 'exclusivo') as o,
                                   count(*) filter (where id in (select id from conf)) as c
                              from v group by grp) t where o + c > 0),
    'only_yours', (select coalesce(jsonb_agg(jsonb_build_object('item_id', v.id, 'name', v.name, 'own_cents', v.own_cents,
                                                                'category', v.item_category, 'group', v.grp)
                     order by v.name collate "C", v.id), '[]')
                     from v where v.comparables = 0 or v.pair_status = 'exclusivo'),
    'confirmed', (select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', v.id, 'name', v.name, 'own_cents', v.own_cents, 'parity_cents', v.parity_cents,
        'category', v.item_category, 'group', v.grp,
        'by_system', not exists (select 1 from public.xray_pair p where p.xray_item_id = v.id and p.by is not null),
        'accepted', (select coalesce(jsonb_agg(jsonb_build_object(
            'pair_id', p.id, 'name', pm.name, 'store', app.monitor_store_label(p_xray, pm.public_store_id),
            'description', pm.description,
            'price_cents', coalesce(sn.price_cents, pm.comparison_price_cents)) order by pm.name collate "C", p.id), '[]')
            from public.xray_pair p join public.public_menu_item pm on pm.id = p.public_menu_item_id
            left join public.public_menu_item_snapshot sn on sn.xray_id = p_xray and sn.public_menu_item_id = pm.id
           where p.xray_item_id = v.id and p.accepted))
        order by app.monitor_group_order(v.grp), v.name collate "C", v.id), '[]')
        from conf v)
  )
$$;
