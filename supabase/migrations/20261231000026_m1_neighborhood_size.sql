-- P23 (Marlon, 11/nov): the recommendation tells how many of the neighborhood's stores this run read, planting the
-- thought of a wider X-ray. monitor_result's stores_total counts the capture slots only; this counts every store of the
-- neighborhood kept in the set.

create function public.monitor_neighborhood_size(p_xray uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.xray_store xs
    join public.xray x on x.id = xs.xray_id
   where xs.xray_id = p_xray and xs.included and xs.public_store_id <> x.target_store_id
$$;
revoke all on function public.monitor_neighborhood_size(uuid) from public, anon, authenticated;
grant execute on function public.monitor_neighborhood_size(uuid) to service_role;
