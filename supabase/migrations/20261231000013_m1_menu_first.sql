-- M1-02 by the store's own menu (Marlon, 08/nov, D76), behind m1.comparacao_faixa: the discovery searches for what the
-- store really sells. When the target's menu is still unknown, its capture comes first; when that capture ends, done or
-- failed, the collect job runs again and queues the discovery.

create function public.xray_queue_menu_first(p_xray uuid, p_env public.flag_env default 'sandbox') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  s public.public_store;
begin
  select * into x from public.xray where id = p_xray;
  select * into s from public.public_store where id = x.target_store_id;
  if s.url is null or not public.flag_enabled('m1.extracao', x.account_id, p_env) then
    return null;
  end if;
  return app.extract_queue_job('extract_capture',
    jsonb_build_object('public_store_id', s.id, 'channel', s.channel, 'external_id', s.external_id, 'url', s.url,
                       'menu_first_xray', x.id),
    x.account_id, 'extract_capture:' || s.id::text);
end $$;
revoke all on function public.xray_queue_menu_first(uuid, public.flag_env) from public, anon, authenticated;
grant execute on function public.xray_queue_menu_first(uuid, public.flag_env) to service_role;

create function app.xray_after_menu_first() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  xid uuid := (new.payload ->> 'menu_first_xray')::uuid;
begin
  perform app.extract_queue_job('collect', jsonb_build_object('xray_id', xid), new.account_id, 'collect:' || xid::text);
  return null;
end $$;

create trigger xray_menu_first after update of status on public.job
  for each row
  when (new.type = 'extract_capture' and new.status in ('done', 'failed') and old.status is distinct from new.status
        and new.payload ? 'menu_first_xray')
  execute function app.xray_after_menu_first();
