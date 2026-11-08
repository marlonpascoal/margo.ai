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

revoke all on function public.monitor_store_lookup(text) from public, anon, authenticated;
grant execute on function public.monitor_store_lookup(text) to service_role;
revoke all on function public.xray_print_token_use(uuid, text) from public, anon, authenticated;
grant execute on function public.xray_print_token_use(uuid, text) to service_role;
revoke all on function public.monitor_result_stores(uuid) from public, anon, authenticated;
grant execute on function public.monitor_result_stores(uuid) to service_role;
revoke all on function public.monitor_head_to_head(uuid) from public, anon, authenticated;
grant execute on function public.monitor_head_to_head(uuid) to service_role;
