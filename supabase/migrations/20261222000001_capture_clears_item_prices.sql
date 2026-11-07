-- B01, M1-05: a capture carries the complete menu, so for an item in a capture copy a missing
-- original_price_cents or minimum_price_cents means no promotion or minimum now, and both become null. Left stale,
-- a minimum would enter parity while price_cents is 0 (public_menu_item.comparison_price_cents).
-- A copy lacking any other field (store fields, description, taxonomy, unit) still leaves it, as does every
-- discovery copy. Everything else is as in 20261220000002; the grants of the function carry over.

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
      insert into public.public_menu_item (public_store_id, external_item_id, name, description, category,
        taxonomy_level1, taxonomy_level2, price_cents, original_price_cents, minimum_price_cents, unit, unit_qty,
        collected_at)
      values (sid, it ->> 'external_item_id', it ->> 'name', it ->> 'description', it ->> 'category',
        it ->> 'taxonomy_level1', it ->> 'taxonomy_level2', (it ->> 'price_cents')::bigint,
        (it ->> 'original_price_cents')::bigint, (it ->> 'minimum_price_cents')::bigint,
        coalesce((it ->> 'unit')::public.menu_unit, 'un'), (it ->> 'unit_qty')::numeric, c.collected_at)
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
        unit = coalesce((it ->> 'unit')::public.menu_unit, public.public_menu_item.unit),
        unit_qty = coalesce(excluded.unit_qty, public.public_menu_item.unit_qty),
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
