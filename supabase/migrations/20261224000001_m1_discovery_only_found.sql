-- M1-01: the stores the target's latest discovery found, plus the target's own terms. A store that only has
-- item taxonomies from another run is no longer returned. Grants on the function carry over.
create or replace function public.xray_discovery(p_xray uuid)
returns table (public_store_id uuid, distance_m int, terms text[])
language sql stable security definer set search_path = '' as $$
  with t as (
    select s.channel, s.external_id from public.xray x
      join public.public_store s on s.id = x.target_store_id where x.id = p_xray
  ), run as (
    select r.id from public.extract_run r, t
     where r.kind = 'discover' and r.status = 'done'
       and r.request ->> 'external_id' = t.external_id and r.request ->> 'channel' = t.channel::text
     order by r.started_at desc limit 1
  ), disc as (
    select s.id, (e.payload ->> 'distance_km')::numeric as km,
           array(select jsonb_array_elements_text(coalesce(e.payload -> 'search_terms', '[]')
                                                  || coalesce(e.payload -> 'taxonomies', '[]'))) as terms
      from public.extract_copy c
      join run on run.id = c.run_id
      join public.extract_content e on e.content_hash = c.content_hash
      join public.public_store s on s.channel = c.channel and s.external_id = c.store_external_id
  ), tax as (
    select m.public_store_id as id, array_agg(distinct m.taxonomy_level2) as terms
      from public.public_menu_item m
     where m.removed_at is null and m.taxonomy_level2 is not null
     group by m.public_store_id
  )
  select coalesce(d.id, x.id), round(d.km * 1000)::int,
         coalesce(d.terms, '{}') || coalesce(x.terms, '{}')
    from disc d full join tax x on x.id = d.id
   where d.id is not null
      or x.id = (select target_store_id from public.xray where id = p_xray)
$$;
