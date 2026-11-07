-- M1-03 on our side (Marlon, 07/nov): when a copy gives no unit_qty, the size comes from the item name, here and only
-- here. It lands in public_menu_item.unit and unit_qty, the columns every reader already uses (app.per_base_m1_03, the
-- Python normalize_m1_03, snapshots, screens), so they cannot disagree. unit_from_name tells a read size from a given
-- one. What a copy says always wins. Seed rows have no copy and never pass through here.
-- app.apply_extract_copy and app.snapshot_xray are otherwise as in their last migrations; grants carry over.

alter table public.public_menu_item add column unit_from_name boolean not null default false;
comment on column public.public_menu_item.unit_from_name is
  'M1-03: true when unit and unit_qty were read from the name; false when a copy gave them or nothing is known.';

-- The size in a single-item name, in base units (g, ml, un), or nulls. Ambiguous means no parse: a combo or a list of
-- items, more than one size, any other number in the name, an impossible quantity. Accents and case do not count;
-- decimals with a comma or a point ("1,5 l", "1.5l"); "1.000 ml" is a thousand, "1.500 kg" could be either.
create function app.size_from_name_m1_03(p_name text, out unit public.menu_unit, out qty numeric)
language plpgsql immutable set search_path = '' as $$
declare
  size_re constant text :=
    '(?:^|[^a-z0-9.,])(\d+(?:[.,]\d+)?)\s*(mls?|lts?|litros?|l|grs?|gramas?|g|kgs?|kilos?|quilos?|und?|unids?|unidades?)(?![a-z0-9])';
  many_re constant text :=
    '\m(combos?|kits?|combinados?|promo|promocao|acompanha\w*|mais|com|leve|pague|dois|duas|tres|quatro|cinco|seis|e|ou)\M|[+&/]|,(?!\d)|(?<!\d),';
  n text;
  hits int;
  m text[];
  num text;
  word text;
  v numeric;
begin
  n := lower(translate(p_name, 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
                               'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'));
  n := regexp_replace(n, '\mcom gas\M', 'gas', 'g');
  if n is null or n ~ many_re then
    return;
  end if;
  select count(*) into hits from regexp_matches(n, size_re, 'g');
  if hits <> 1 or regexp_replace(n, size_re, ' ', 'g') ~ '\m\d+(?:[.,]\d+)?x?\M' then
    return;
  end if;
  m := regexp_match(n, size_re);
  num := m[1];
  word := m[2];

  if num ~ '^[1-9]\d{0,2}\.\d{3}$' then
    if word !~ '^(ml|g)' then
      return;
    end if;
    num := replace(num, '.', '');
  elsif num ~ ',\d{3}$' and word ~ '^(ml|g)' then
    return;
  end if;
  v := replace(num, ',', '.')::numeric;

  if word ~ '^(l|kg|kilo|quilo)' then
    v := v * 1000;
  end if;
  if word ~ '^un' then
    if v <> trunc(v) or v < 1 or v > 1000 then
      return;
    end if;
    unit := 'un';
  else
    if v < 1 or v > 100000 then
      return;
    end if;
    unit := case when word ~ '^(ml|l)' then 'ml' else 'g' end;
  end if;
  qty := round(v, 2);
end $$;

-- M1-03: what the row holds after a copy. p_unit and p_qty come from the copy, p_old_* from the row. An explicit
-- size wins (a quantity, or g, ml or pack; "un" alone is what extractors send by default and says nothing about size).
-- A size a former copy gave stays when this one lacks it. Otherwise the name decides, each time.
create function app.item_unit_m1_03(
  p_name text, p_unit public.menu_unit, p_qty numeric,
  p_old_unit public.menu_unit, p_old_qty numeric, p_old_from_name boolean,
  out unit public.menu_unit, out qty numeric, out from_name boolean
)
language plpgsql immutable set search_path = '' as $$
declare
  parsed record;
  was_read boolean := coalesce(p_old_from_name, false);
begin
  from_name := false;
  if p_qty is not null or p_unit in ('g', 'ml', 'pack') then
    unit := coalesce(p_unit, case when was_read then 'un'::public.menu_unit else p_old_unit end, 'un');
    qty := coalesce(p_qty, case when was_read then null else p_old_qty end);
    return;
  end if;
  if not was_read and (p_old_unit <> 'un' or p_old_qty is not null) then
    unit := p_old_unit;
    qty := p_old_qty;
    return;
  end if;
  select * into parsed from app.size_from_name_m1_03(p_name);
  if parsed.qty is not null then
    unit := parsed.unit;
    qty := parsed.qty;
    from_name := true;
    return;
  end if;
  unit := coalesce(p_unit, 'un');
  qty := null;
end $$;

-- M1-03: the base unit an item compares in, as in margo_collector.rules.normalize_m1_03.
create function app.base_unit_m1_03(p_unit public.menu_unit, p_qty numeric) returns text
language sql immutable set search_path = '' as $$
  select case when p_unit = 'g' then 'g'
              when p_unit = 'ml' then 'ml'
              when p_unit = 'pack' and p_qty is null then 'combo'
              else 'un' end
$$;

create or replace function app.apply_extract_copy(p_copy uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.extract_copy;
  complete_menu boolean;
  p jsonb;
  s jsonb;
  f jsonb;
  newer text[];
  sid uuid;
  it jsonb;
  old public.public_menu_item;
  u record;
begin
  select * into c from public.extract_copy where id = p_copy;
  if not found then
    raise exception 'unknown extract copy %', p_copy using errcode = 'no_data_found';
  end if;
  select e.payload into p from public.extract_content e where e.content_hash = c.content_hash;
  s := jsonb_strip_nulls(coalesce(p -> 'store', '{}'));
  select r.kind = 'capture' into complete_menu from public.extract_run r where r.id = c.run_id;

  insert into public.public_store (channel, external_id)
  values (c.channel, c.store_external_id)
  on conflict (channel, external_id) do nothing;
  select ps.id into sid from public.public_store ps
   where ps.channel = c.channel and ps.external_id = c.store_external_id;

  select coalesce(array_agg(distinct k), '{}') into newer
    from public.extract_copy n
    join public.extract_content e on e.content_hash = n.content_hash
    cross join lateral jsonb_object_keys(jsonb_strip_nulls(coalesce(e.payload -> 'store', '{}'))) k
   where n.channel = c.channel and n.store_external_id = c.store_external_id and n.collected_at > c.collected_at;
  f := s - newer;

  update public.public_store ps set
    name = coalesce(f ->> 'name', ps.name),
    url = coalesce(f ->> 'url', ps.url),
    slug = coalesce(f ->> 'slug', ps.slug),
    area = coalesce(f ->> 'area', ps.area),
    category = coalesce(f ->> 'category', ps.category),
    main_category_code = coalesce(f ->> 'main_category_code', ps.main_category_code),
    super_categories = case when f ? 'super_categories'
      then array(select jsonb_array_elements_text(f -> 'super_categories')) else ps.super_categories end,
    rating = coalesce((f ->> 'rating')::numeric, ps.rating),
    rating_count = coalesce((f ->> 'rating_count')::int, ps.rating_count),
    lat = coalesce((f ->> 'lat')::numeric, ps.lat),
    lng = coalesce((f ->> 'lng')::numeric, ps.lng),
    last_seen_open_at = case when (s ->> 'is_open')::boolean is true
      then greatest(ps.last_seen_open_at, c.collected_at) else ps.last_seen_open_at end
   where ps.id = sid;

  if s ? 'address' then
    insert into public.public_store_private (public_store_id, address, collected_at)
    values (sid, s ->> 'address', c.collected_at)
    on conflict (public_store_id) do update
      set address = excluded.address, collected_at = excluded.collected_at
      where public.public_store_private.collected_at <= excluded.collected_at;
  end if;

  if p ? 'items' then
    for it in select jsonb_strip_nulls(v) from jsonb_array_elements(p -> 'items') v loop
      old := null;
      select * into old from public.public_menu_item m
       where m.public_store_id = sid and m.external_item_id = it ->> 'external_item_id';
      select * into u from app.item_unit_m1_03(it ->> 'name', (it ->> 'unit')::public.menu_unit,
        (it ->> 'unit_qty')::numeric, old.unit, old.unit_qty, old.unit_from_name);
      insert into public.public_menu_item (public_store_id, external_item_id, name, description, category,
        taxonomy_level1, taxonomy_level2, price_cents, original_price_cents, minimum_price_cents, unit, unit_qty,
        unit_from_name, collected_at)
      values (sid, it ->> 'external_item_id', it ->> 'name', it ->> 'description', it ->> 'category',
        it ->> 'taxonomy_level1', it ->> 'taxonomy_level2', (it ->> 'price_cents')::bigint,
        (it ->> 'original_price_cents')::bigint, (it ->> 'minimum_price_cents')::bigint,
        u.unit, u.qty, u.from_name, c.collected_at)
      on conflict (public_store_id, external_item_id) do update set
        name = excluded.name,
        price_cents = excluded.price_cents,
        description = coalesce(excluded.description, public.public_menu_item.description),
        category = coalesce(excluded.category, public.public_menu_item.category),
        taxonomy_level1 = coalesce(excluded.taxonomy_level1, public.public_menu_item.taxonomy_level1),
        taxonomy_level2 = coalesce(excluded.taxonomy_level2, public.public_menu_item.taxonomy_level2),
        original_price_cents = case when complete_menu then excluded.original_price_cents
          else coalesce(excluded.original_price_cents, public.public_menu_item.original_price_cents) end,
        minimum_price_cents = case when complete_menu then excluded.minimum_price_cents
          else coalesce(excluded.minimum_price_cents, public.public_menu_item.minimum_price_cents) end,
        unit = excluded.unit,
        unit_qty = excluded.unit_qty,
        unit_from_name = excluded.unit_from_name,
        collected_at = excluded.collected_at,
        removed_at = case when public.public_menu_item.removed_at > excluded.collected_at
                          then public.public_menu_item.removed_at end
       where public.public_menu_item.collected_at <= excluded.collected_at;
    end loop;

    -- An item missing from a newer capture is marked removed, never deleted.
    update public.public_menu_item m set removed_at = c.collected_at
     where m.public_store_id = sid and m.removed_at is null and m.collected_at < c.collected_at
       and not exists (select 1 from jsonb_array_elements(p -> 'items') v
                        where v ->> 'external_item_id' = m.external_item_id);
  end if;
  return sid;
end $$;

comment on function app.apply_extract_copy(uuid) is
  'D47c: apply one copy to public_store, public_menu_item and public_store_private. Idempotent; re-running over old copies is safe.';

-- Copies already applied pick the size up: oldest first, as they arrived. Rows without a copy (G-SYN) are not touched.
do $$
declare c uuid;
begin
  for c in
    select cp.id from public.extract_copy cp join public.extract_content e on e.content_hash = cp.content_hash
     where e.payload ? 'items' order by cp.collected_at, cp.id
  loop
    perform app.apply_extract_copy(c);
  end loop;
end $$;

revoke all on function app.size_from_name_m1_03(text) from public, anon, authenticated;
revoke all on function app.item_unit_m1_03(text, public.menu_unit, numeric, public.menu_unit, numeric, boolean) from public, anon, authenticated;
revoke all on function app.base_unit_m1_03(public.menu_unit, numeric) from public, anon, authenticated;

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
      select xi.id, own.public_store_id as own_store, app.base_unit_m1_03(own.unit, own.unit_qty) as own_unit,
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
         and app.base_unit_m1_03(c.unit, c.unit_qty) = it.own_unit
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
