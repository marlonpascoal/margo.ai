-- P23 "Como fizemos este raio-X" shows the radius as a small map (Marlon, 08/nov): the store at the center, the stores
-- the run read as dots. monitor_map gives each compared store (app.xray_compared_store_ids, the same set as "Lemos N
-- lojas vizinhas") as an offset in km from the target, east (x) and north (y), rounded to 10 m. No names, no
-- coordinates of the target leave the database. Null when the target has no coordinates. Service role only, like the
-- other monitor_* loaders: the portal checks the person first (D63).

create function public.monitor_map(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when t.lat is null or t.lng is null then null else jsonb_build_object(
    'radius_km', x.radius_km,
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'x_km', round((s.lng - t.lng) * 111.195 * cos(radians(t.lat::float8))::numeric, 2),
               'y_km', round((s.lat - t.lat) * 111.195, 2))
             order by s.id)
        from app.xray_compared_store_ids(p_xray) c(id)
        join public.public_store s on s.id = c.id
       where s.lat is not null and s.lng is not null), '[]'::jsonb)
  ) end
    from public.xray x join public.public_store t on t.id = x.target_store_id
   where x.id = p_xray
$$;
revoke all on function public.monitor_map(uuid) from public, anon, authenticated;
grant execute on function public.monitor_map(uuid) to service_role;
