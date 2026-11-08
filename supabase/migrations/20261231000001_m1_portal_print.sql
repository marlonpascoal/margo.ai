-- M1 owner journey, screens part (docs/m1-owner-journey-draft.md §2.7, §10 "not built here"; build-review 07/nov).
--
--   monitor_result_stores(xray)  P23 "Ver as lojas": per analyzed item, the stores whose item was accepted as the same,
--                                with the price per the owner's unit (same base as the strip, M1-03), cheapest first.
--   monitor_head_to_head(xray)   P23 competitor view "Você e o Concorrente": items the owner's own store and the
--                                competitor both sell, from the newest calculated run of an own monitoring whose
--                                neighborhood holds the competitor (draft §8: hidden when none does).
--   monitor_store_lookup(ext)    P20: name, area, category and public link the catalog knows of an iFood store.
--   xray_print, xray_print_token "Baixar PDF" (Marlon, 07/nov: the PDF is the result screen printed). worker-render prints
--                                /imprimir/raio-x/[xray] with Playwright, opening it with a one-time token it minted
--                                here (only the hash is kept, valid 5 minutes); each printed copy is cached per result
--                                `version` (monitor_result). The console P01 path (xray.pdf_path, C05/C06) is unchanged.
--
--   exclusivo (Stage 2)          monitor_doubts, monitor_items, monitor_result count an `exclusivo` item as "só seu".
--
-- Service role only, like the other monitor_* loaders: the web app checks the person (RLS read of the monitoring) first.

create table public.xray_print (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  version text not null,
  path text not null,
  bytes int not null check (bytes > 0),
  pages int not null check (pages > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_id, version)
);
comment on table public.xray_print is
  'P23 "Baixar PDF": the result screen printed by worker-render (Playwright), one file per result version, in the private pdf bucket.';

create table public.xray_print_token (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.xray_print_token is
  'One-time pass for worker-render to open /imprimir/raio-x/[xray] without a portal session: sha256 of the token, 5 minutes, used once.';

alter table public.xray_print enable row level security;
alter table public.xray_print_token enable row level security;
-- No policy: only the service role reaches them (the PDF is served by /api/raio-x/[monitor]/pdf after the person's check).

-- The print page: the token is good once, for this run, before it expires. True when it was.
create function public.xray_print_token_use(p_xray uuid, p_hash text) returns boolean
language sql volatile security definer set search_path = '' as $$
  with used as (
    update public.xray_print_token t set used_at = now(), updated_at = now()
     where t.token_hash = p_hash and t.xray_id = p_xray and t.used_at is null and t.expires_at > now()
    returning 1
  )
  select exists (select 1 from used)
$$;

-- P23 "Ver as lojas (N)": accepted comparable items per analyzed item of the run, with the store as the owner may see it
-- (app.monitor_store_label, Q7), the price per the owner's unit as the strip computes it, cheapest first.
create function public.monitor_result_stores(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with rows as (
    select i.id as item_id, pm.public_store_id,
           round(app.per_base_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty)
                 * coalesce(om.unit_qty, 1))::bigint as price
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

-- P23 competitor view, head-to-head: for a competitor run, the newest calculated run of each own monitoring of the
-- account whose store set includes the competitor; the one with most items in common. Own price of that run, and the
-- competitor's price per the owner's unit. Null when no own run has the competitor in its neighborhood.
create function public.monitor_head_to_head(p_xray uuid) returns jsonb
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
           min(round(app.per_base_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty)
                     * coalesce(om.unit_qty, 1)))::bigint as their_cents
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

-- P20 after a paste ("Loja encontrada: ...") and "Uma loja minha" (its public link): what the public catalog knows of an
-- iFood store. No address (D47c).
create function public.monitor_store_lookup(p_external_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', s.name, 'area', s.area, 'category', s.category, 'url', s.url)
    from public.public_store s where s.channel = 'ifood' and s.external_id = p_external_id
$$;

-- M1-04 Stage 2 (20261229000001, merged from main): an `exclusivo` item (no item of the same attributes nearby) is
-- "Itens só seus" on the owner's screens ("ninguém por perto vende algo igual"), never a doubt, even when it keeps
-- unaccepted candidates. Same loaders as 20261230000001 with that one change.

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
        'category', i.item_category, 'group', app.monitor_item_group(i.item_category, i.n_pairs),
        'unit', v.unit, 'unit_qty', v.unit_qty, 'pair_note', i.pair_note, 'item_category', i.item_category,
        'answered', i.reviewed_at is not null, 'answered_at', i.reviewed_at,
        'answered_by', (select pe.name from public.person pe where pe.id = i.reviewed_by),
        'answered_by_staff', exists (select 1 from public.staff st where st.person_id = i.reviewed_by),
        'stores', (select count(distinct pm.public_store_id) from public.xray_pair p
                     join public.public_menu_item pm on pm.id = p.public_menu_item_id where p.xray_item_id = i.id),
        'candidates', (select coalesce(jsonb_agg(jsonb_build_object(
            'pair_id', p.id, 'name', pm.name, 'store', app.monitor_store_label(p_xray, pm.public_store_id),
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
            'price_cents', coalesce(sn.price_cents, pm.comparison_price_cents)) order by pm.name collate "C", p.id), '[]')
            from public.xray_pair p join public.public_menu_item pm on pm.id = p.public_menu_item_id
            left join public.public_menu_item_snapshot sn on sn.xray_id = p_xray and sn.public_menu_item_id = pm.id
           where p.xray_item_id = v.id and p.accepted))
        order by app.monitor_group_order(v.grp), v.name collate "C", v.id), '[]')
        from conf v)
  )
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
           min(app.per_base_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty)
               * coalesce(om.unit_qty, 1)) as low,
           max(app.per_base_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty)
               * coalesce(om.unit_qty, 1)) as high,
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


revoke all on function public.monitor_store_lookup(text) from public, anon, authenticated;
grant execute on function public.monitor_store_lookup(text) to service_role;
revoke all on function public.xray_print_token_use(uuid, text) from public, anon, authenticated;
grant execute on function public.xray_print_token_use(uuid, text) to service_role;
revoke all on function public.monitor_result_stores(uuid) from public, anon, authenticated;
grant execute on function public.monitor_result_stores(uuid) to service_role;
revoke all on function public.monitor_head_to_head(uuid) from public, anon, authenticated;
grant execute on function public.monitor_head_to_head(uuid) to service_role;
