-- P20 "Uma loja minha" by the iFood link (Marlon, 08/nov): the owner pastes the link of their own store, as for a
-- competitor, and says it is theirs. Until now an own monitoring needed the store in channel_store (Lojas, from the
-- full product), which an X-ray-only account never has, so owners had to register their own store as a competitor.
-- monitor_create takes p_kind ('own' | 'competitor' | null): 'own' makes the monitoring own even without a channel_store
-- row (kitchen from channel_store when there is one, else none); null keeps the old rule (own when the account's
-- channel_store has the store). A store in the account's channel_store is always own. New refusal:
--   monitor_bad_kind   p_kind other than own, competitor or null
-- A run's xray.target_kind is derived by trigger (app.xray_target_kind, 20261105000010) from channel_store only; it now
-- also reads 'own' for a run of an own monitoring.

drop function public.monitor_create(uuid, text, text, uuid, int, int, text[], jsonb, uuid, public.flag_env, inet, text);

create function public.monitor_create(
  p_account uuid, p_external_id text, p_url text, p_kitchen uuid, p_every_days int, p_radius_km int,
  p_categories text[], p_rules jsonb, p_actor uuid, p_env public.flag_env default 'sandbox',
  p_ip inet default null, p_user_agent text default null, p_kind text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who public.actor_kind;
  store_id uuid;
  kind text;
  kitchen uuid;
  lim int;
  u record;
  existing uuid;
  mid uuid;
  xid uuid;
  min_days int;
begin
  who := app.monitor_manager(p_account, p_actor);
  if not public.flag_enabled('m1.portal', p_account, p_env) or not public.flag_enabled('m1.raio_x', p_account, p_env) then
    raise exception 'monitor_not_enabled';
  end if;
  if p_kind is not null and p_kind not in ('own', 'competitor') then
    raise exception 'monitor_bad_kind';
  end if;
  if p_external_id is null or p_external_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'monitor_bad_store';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('monitor:' || p_account::text, 0));
  select cs.kitchen_id into kitchen from public.channel_store cs
   where cs.account_id = p_account and cs.channel = 'ifood' and cs.external_id = p_external_id;
  -- An owner may name the store as theirs by its iFood link alone (Marlon, 08/nov): no channel_store needed.
  kind := case when found or p_kind = 'own' then 'own' else 'competitor' end;
  if kind = 'competitor' then
    if p_kitchen is not null and not exists (select 1 from public.kitchen k where k.id = p_kitchen and k.account_id = p_account) then
      raise exception 'monitor_bad_kitchen';
    end if;
    kitchen := p_kitchen;
  end if;

  insert into public.public_store (channel, external_id, url)
  values ('ifood', p_external_id, p_url)
  on conflict (channel, external_id) do update set url = coalesce(public.public_store.url, excluded.url)
  returning id into store_id;
  select m.id into existing from public.xray_monitor m
   where m.account_id = p_account and m.target_store_id = store_id and m.status <> 'removed';
  if existing is not null then
    raise exception 'monitor_exists:%', existing;
  end if;
  min_days := app.monitor_min_every_days(p_account);
  if p_every_days is null or p_every_days < min_days then
    raise exception 'monitor_min_every_days:%', min_days;
  end if;

  select * into u from app.monitor_usage(p_account);
  if kind = 'competitor' then
    if not public.flag_enabled('m1.concorrente', p_account, p_env) then
      raise exception 'competitor_xray_not_in_plan';
    end if;
    lim := app.monitor_competitor_max(p_account, p_env);
    if u.competitor_active >= lim then
      raise exception 'monitor_competitor_limit:%', lim;
    end if;
    if app.monitor_param('m1.monitor_count_month_starts', 1) = 1 and u.competitor_started_month >= lim then
      raise exception 'monitor_competitor_month_limit:%', lim;
    end if;
  else
    lim := app.monitor_own_max(p_account);
    if lim is not null and u.own_active >= lim then
      raise exception 'monitor_own_limit:%', lim;
    end if;
  end if;

  insert into public.xray_monitor (account_id, target_store_id, target_kind, kitchen_id, every_days, radius_km, categories,
                                   rules, env, created_by, updated_by)
  values (p_account, store_id, kind, kitchen, p_every_days, p_radius_km, coalesce(p_categories, '{}'),
          coalesce(p_rules, '{}'), p_env, p_actor, p_actor)
  returning id into mid;
  xid := app.monitor_start_run(mid, p_actor, now(), true);
  perform app.monitor_audit(p_actor, who, p_account, 'monitor.create', 'xray_monitor', mid, null,
    jsonb_build_object('target_store_id', store_id, 'target_kind', kind, 'kitchen_id', kitchen, 'every_days', p_every_days,
                       'radius_km', p_radius_km, 'categories', p_categories, 'rules', p_rules, 'xray_id', xid),
    p_ip, p_user_agent);
  return jsonb_build_object('monitor_id', mid, 'xray_id', xid, 'target_kind', kind);
end $$;

revoke all on function public.monitor_create(uuid, text, text, uuid, int, int, text[], jsonb, uuid, public.flag_env, inet, text, text)
  from public, anon, authenticated;
grant execute on function public.monitor_create(uuid, text, text, uuid, int, int, text[], jsonb, uuid, public.flag_env, inet, text, text)
  to service_role;

create or replace function app.xray_target_kind() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.target_kind := case when new.account_id is not null and (
      exists (select 1 from public.public_store ps
                join public.channel_store cs on cs.channel = ps.channel and cs.external_id = ps.external_id
               where ps.id = new.target_store_id and cs.account_id = new.account_id)
      or exists (select 1 from public.xray_monitor m where m.id = new.monitor_id and m.target_kind = 'own'))
    then 'own' else 'competitor' end;
  return new;
end $$;
