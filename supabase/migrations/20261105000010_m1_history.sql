-- M1 history (Marlon, 31/out: "the X-ray must keep history so we can follow the evolution of the products
-- and of the store's overall ranking"). Every collection becomes a dated snapshot that is never rewritten:
--   public_store_snapshot      the public stores of a run, as seen in that run
--   public_menu_item_snapshot  their menu items and prices in that run (immutable)
--   xray_store_rank            proposed rule M1-10: price index and position of each store in the run
-- public_store and public_menu_item stay the "latest seen" catalog the worker pairs against; the snapshots
-- are what history reads. app.snapshot_xray(xray_id) writes them; the worker calls it after collection and
-- after the calculation, and it only adds rows (a second call keeps the first prices).
--
-- Plus xray.target_kind: whether the target is one of the account's own channel stores ('own') or another
-- store ('competitor'), derived by trigger. No plan limit reads it yet.

-- Own store or competitor --------------------------------------------------------------------------

alter table public.xray add column target_kind text not null default 'competitor'
  check (target_kind in ('own', 'competitor'));
comment on column public.xray.target_kind is
  '''own'' when the target public store matches a channel_store of the account (same channel and external id), else ''competitor''. Derived by trigger; not a plan limit.';

create function app.xray_target_kind() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.target_kind := case when new.account_id is not null and exists (
      select 1 from public.public_store ps
        join public.channel_store cs on cs.channel = ps.channel and cs.external_id = ps.external_id
       where ps.id = new.target_store_id and cs.account_id = new.account_id)
    then 'own' else 'competitor' end;
  return new;
end $$;

create trigger xray_target_kind before insert or update of account_id, target_store_id, target_kind on public.xray
  for each row execute function app.xray_target_kind();

update public.xray set target_kind = target_kind;

-- Snapshots ----------------------------------------------------------------------------------------

create table public.public_store_snapshot (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  public_store_id uuid not null references public.public_store (id),
  name text,
  area text,
  category text,
  is_national_chain boolean not null,
  last_seen_open_at timestamptz,
  collected_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_id, public_store_id)
);
comment on table public.public_store_snapshot is 'M1 history: a public store as seen in one X-ray run (D47 fields only). Never updated.';

create table public.public_menu_item_snapshot (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  public_store_id uuid not null references public.public_store (id),
  public_menu_item_id uuid not null references public.public_menu_item (id),
  name text not null,
  price_cents bigint not null check (price_cents >= 0),
  unit public.menu_unit not null,
  unit_qty numeric(10, 2),
  collected_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_id, public_menu_item_id)
);
comment on table public.public_menu_item_snapshot is 'M1 history: a menu item and its price in one X-ray run. Never updated.';

create table public.xray_store_rank (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null references public.xray (id) on delete cascade,
  public_store_id uuid not null references public.public_store (id),
  is_target boolean not null,
  price_index numeric(7, 4) not null check (price_index > 0),
  items_compared int not null check (items_compared > 0),
  rank int not null check (rank > 0),
  stores_ranked int not null check (stores_ranked >= rank),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xray_id, public_store_id)
);
comment on table public.xray_store_rank is
  'M1-10 (proposed): price index = median over the target''s analyzed items of (store normalized price / median normalized price of the accepted comparables); rank 1 = lowest index among the stores with at least one compared item, target included. Never updated.';

create index public_menu_item_snapshot_item on public.public_menu_item_snapshot (public_menu_item_id);
create index public_store_snapshot_store on public.public_store_snapshot (public_store_id);
create index xray_store_rank_store on public.xray_store_rank (public_store_id);

create function app.history_is_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'M1 history rows are never changed (%)', tg_table_name using errcode = 'restrict_violation';
end $$;

do $$
declare t text;
begin
  foreach t in array array['public_store_snapshot', 'public_menu_item_snapshot', 'xray_store_rank'] loop
    execute format('create trigger immutable before update on public.%I
                    for each row execute function app.history_is_immutable()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy read on public.%I for select to authenticated using (app.is_staff())', t);
  end loop;
end $$;

-- M1-03 price per base unit, as in margo_collector.rules.normalize_m1_03 (a combo compares whole).
create function app.per_base_m1_03(p_price bigint, p_unit public.menu_unit, p_qty numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_unit = 'pack' and p_qty is null then p_price::numeric
              else p_price::numeric / coalesce(p_qty, 1) end
$$;

-- Writes the run's snapshots and its M1-10 ranking. Only adds: rows already there for this run are kept.
create function app.snapshot_xray(p_xray uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  at timestamptz;
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

  -- M1-10 only once the run is calculated, and only once per run.
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
      from idx;
  end if;
end $$;

revoke all on function app.snapshot_xray(uuid) from public;
grant execute on function app.snapshot_xray(uuid) to service_role;

-- Snapshot every X-ray already calculated (the seed's, on a fresh reset).
select app.snapshot_xray(id) from public.xray where status in ('ready', 'delivered');
