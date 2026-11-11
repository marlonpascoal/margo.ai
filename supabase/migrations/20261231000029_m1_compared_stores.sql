-- P23 "Com quem comparamos" (Marlon, 11/nov, after a customer's feedback): the result lists the stores this run read, by
-- name, category and distance, nearest first. Only public iFood data the run already holds; never a price per store.
-- The same set as monitor_result's stores_read: capture rows that finished; a run without captures (seed) lists the
-- stores it compares with.
create function public.monitor_compared_stores(p_xray uuid)
returns table (name text, category text, distance_m int)
language sql stable security definer set search_path = '' as $$
  with caps as (select c.public_store_id, c.distance_m from app.monitor_capture_rows(p_xray) c
                 where c.state = 'done' and not c.is_target),
  ids as (
    select public_store_id, distance_m from caps
    union all
    select c.id, xs.distance_m from app.xray_compared_store_ids(p_xray) c(id)
      left join public.xray_store xs on xs.xray_id = p_xray and xs.public_store_id = c.id
     where not exists (select 1 from caps)
  )
  select s.name, s.category, ids.distance_m
    from ids join public.public_store s on s.id = ids.public_store_id
   order by ids.distance_m nulls last, s.name
$$;
revoke all on function public.monitor_compared_stores(uuid) from public, anon, authenticated;
grant execute on function public.monitor_compared_stores(uuid) to service_role;
