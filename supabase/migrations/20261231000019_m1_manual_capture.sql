-- Manual capture of the whole X-ray (Marlon, 08/nov). The owner's button starts a monitored run now and asks for a fresh
-- capture of the target and of every capture slot, even a store read inside m1.extract_every_days. Behind the flag
-- m1.captura_manual (on in sandbox, off in production), for who manages monitorings, audited, one per
-- m1.manual_capture_min_hours. app.monitor_start_run is otherwise as in 20261231000014.

insert into public.feature_flag (key, description, default_raio_x, default_lucro, default_rede, env)
select 'm1.captura_manual', 'Botão que pede uma captura nova do raio-X inteiro, no resultado do raio-X',
       s = 'sandbox', s = 'sandbox', s = 'sandbox', s::public.flag_env
  from unnest(array['sandbox', 'production']) s;

insert into public.rule_param (key, value, description) values
  ('m1.manual_capture_min_hours', 24, 'Hours between two manual captures of the same monitoring.');

alter table public.xray_monitor add column last_manual_run_at timestamptz;
comment on column public.xray_monitor.last_manual_run_at is 'When the owner last asked for a manual capture of the whole X-ray.';

-- As public.extract_queue_xray_captures, without asking whether each store is due.
create function app.xray_force_captures(p_xray uuid, p_env public.flag_env) returns int
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  sid uuid;
  n int := 0;
begin
  select * into x from public.xray where id = p_xray;
  if not public.flag_enabled('m1.extracao', x.account_id, p_env) then
    return 0;
  end if;
  perform app.xray_capture_fill(p_xray);
  for sid in
    select x.target_store_id
    union all
    select xs.public_store_id from public.xray_store xs
     where xs.xray_id = p_xray and xs.included and xs.capture_slot and xs.public_store_id <> x.target_store_id
  loop
    if app.extract_queue_capture(sid, x.account_id) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

drop function app.monitor_start_run(uuid, uuid, timestamptz, boolean);

create function app.monitor_start_run(p_monitor uuid, p_actor uuid, p_at timestamptz, p_force_discover boolean, p_force_capture boolean default false) returns uuid
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
    if p_force_capture then
      perform app.xray_force_captures(xid, m.env);
    else
      perform public.extract_queue_xray_captures(xid, m.env);
    end if;
    perform app.monitor_advance(xid);
  end if;
  update public.xray_monitor
     set last_xray_id = xid, next_run_at = p_at + make_interval(days => app.monitor_effective_days(m))
   where id = m.id;
  return xid;
end $$;

create function public.monitor_run_now(
  p_monitor uuid, p_actor uuid, p_env public.flag_env default 'sandbox',
  p_ip inet default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.xray_monitor;
  who public.actor_kind;
  hours int := app.monitor_param('m1.manual_capture_min_hours', 24)::int;
  xid uuid;
begin
  m := app.monitor_row(p_monitor);
  who := app.monitor_manager(m.account_id, p_actor);
  perform pg_advisory_xact_lock(hashtextextended('monitor:' || m.account_id::text, 0));
  if not public.flag_enabled('m1.captura_manual', m.account_id, p_env) then
    raise exception 'monitor_not_enabled';
  end if;
  if m.status <> 'active' then
    raise exception 'monitor_not_active';
  end if;
  if exists (select 1 from public.xray x where x.monitor_id = m.id and x.status in ('collecting', 'pairing')) then
    raise exception 'monitor_run_active';
  end if;
  if m.last_manual_run_at > now() - make_interval(hours => hours) then
    raise exception 'monitor_run_too_soon:%', hours;
  end if;
  xid := app.monitor_start_run(m.id, p_actor, now(), false, true);
  update public.xray_monitor set last_manual_run_at = now(), updated_by = p_actor where id = m.id;
  perform app.monitor_audit(p_actor, who, m.account_id, 'monitor.run_now', 'xray_monitor', m.id,
    null, jsonb_build_object('xray_id', xid), p_ip, p_user_agent);
  return xid;
end $$;

revoke all on function app.monitor_start_run(uuid, uuid, timestamptz, boolean, boolean) from public, anon, authenticated;
revoke all on function app.xray_force_captures(uuid, public.flag_env) from public, anon, authenticated;
revoke all on function public.monitor_run_now(uuid, uuid, public.flag_env, inet, text) from public, anon, authenticated;
grant execute on function public.monitor_run_now(uuid, uuid, public.flag_env, inet, text) to service_role;
