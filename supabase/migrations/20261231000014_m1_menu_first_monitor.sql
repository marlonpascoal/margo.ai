-- D76: a monitored run reaches the discovery through the collect job when m1.comparacao_faixa is on, so the search follows
-- the store's own menu. Same function as 20261230000001 with that one change.

create or replace function app.monitor_start_run(p_monitor uuid, p_actor uuid, p_at timestamptz, p_force_discover boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.xray_monitor;
  prev public.xray;
  xid uuid;
begin
  select * into m from public.xray_monitor where id = p_monitor for update;
  select x.* into prev from public.xray x
   where x.monitor_id = m.id and exists (select 1 from public.xray_store xs where xs.xray_id = x.id)
   order by x.created_at desc limit 1;
  insert into public.xray (account_id, target_store_id, radius_km, categories, rules, status, created_by, monitor_id, created_at)
  values (m.account_id, m.target_store_id, m.radius_km, m.categories, m.rules, 'collecting', p_actor, m.id, clock_timestamp())
  returning id into xid;
  if p_force_discover or prev.id is null or m.discovered_at is null
     or m.discovered_at <= p_at - make_interval(days => app.monitor_param('m1.monitor_rediscover_days', 28)::int)
     or prev.radius_km <> m.radius_km or prev.categories <> m.categories or prev.rules <> m.rules then
    -- D76: the collect job reads the target's menu first and then queues the discovery.
    if public.flag_enabled('m1.comparacao_faixa', m.account_id, m.env) then
      perform app.extract_queue_job('collect', jsonb_build_object('xray_id', xid), m.account_id, 'collect:' || xid::text);
    else
      perform public.extract_queue_discover(xid, m.env);
    end if;
    update public.xray_monitor set discovered_at = p_at where id = m.id;
  else
    insert into public.xray_store (xray_id, public_store_id, distance_m, delivers_to_target, included, exclusion_reason,
                                   capture_slot, capture_score, capture_rank)
    select xid, xs.public_store_id, xs.distance_m, xs.delivers_to_target, xs.included, xs.exclusion_reason,
           xs.capture_slot, xs.capture_score, xs.capture_rank
      from public.xray_store xs where xs.xray_id = prev.id;
    update public.xray set collected_at = p_at where id = xid;
    perform public.extract_queue_xray_captures(xid, m.env);
    perform app.monitor_advance(xid);
  end if;
  update public.xray_monitor
     set last_xray_id = xid, next_run_at = p_at + make_interval(days => app.monitor_effective_days(m))
   where id = m.id;
  return xid;
end $$;
