-- The channel's item type (Marlon, 08/nov), such as a default item, a combo or a half-and-half pizza. It comes from the
-- same read as the complements and follows their rule: sent replaces, absent leaves, unless a capture gives the item a
-- fixed price. Kept as the channel wrote it because its values are not all known yet, and captured now because every
-- later read is paid. No comparison uses it yet. app.apply_extract_copy is otherwise as in 20261231000017; grants carry over.

alter table public.public_menu_item add column item_type text;
comment on column public.public_menu_item.item_type is
  'The channel''s item type as captured, read together with choices. Null when unknown or when the item has a fixed price.';

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
        unit_from_name, choices, item_type, collected_at)
      values (sid, it ->> 'external_item_id', it ->> 'name', it ->> 'description', it ->> 'category',
        it ->> 'taxonomy_level1', it ->> 'taxonomy_level2', (it ->> 'price_cents')::bigint,
        (it ->> 'original_price_cents')::bigint, (it ->> 'minimum_price_cents')::bigint,
        u.unit, u.qty, u.from_name, nullif(it -> 'choices', '[]'::jsonb), it ->> 'type', c.collected_at)
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
        choices = case when it ? 'choices' then excluded.choices
          when complete_menu and excluded.price_cents > 0 then null
          else public.public_menu_item.choices end,
        item_type = case when it ? 'type' then excluded.item_type
          when complete_menu and excluded.price_cents > 0 then null
          else public.public_menu_item.item_type end,
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
