-- M1 console writes (05 C02 to C06). Each function checks that the actor is staff (04 §5: X-rays are
-- Fundador and Operação), makes the change and writes audit_log in one transaction (A04). The web app
-- calls them with the service role after requireConsole("clients"); jobs are enqueued by the web app
-- (lib/jobs) so the worker is woken (02 §4).

create function app.require_staff(p_actor uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not exists (select 1 from public.staff s where s.person_id = p_actor) then
    raise exception 'only staff change X-rays (04 §5)' using errcode = 'insufficient_privilege';
  end if;
end $$;

create function app.audit_staff(
  p_actor uuid, p_account uuid, p_action text, p_entity text, p_entity_id uuid,
  p_before jsonb, p_after jsonb, p_ip inet, p_user_agent text
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id,
                                before, after, ip, user_agent)
  values (p_actor, 'staff', p_account, p_action, p_entity, p_entity_id, p_before, p_after, p_ip, p_user_agent)
$$;

-- C02 "Buscar vizinhança": the X-ray in `collecting`. The target store joins the public catalog by its
-- iFood uuid (D29); the account is the one whose channel store has that uuid, else null (a lead).
create function public.xray_create(
  p_external_id text, p_url text, p_radius_km int, p_categories text[], p_rules jsonb,
  p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  store_id uuid;
  acc uuid;
  new_id uuid;
begin
  perform app.require_staff(p_actor);
  if p_external_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'the iFood store id is a uuid (D29)' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.public_store (channel, external_id, url)
  values ('ifood', p_external_id, p_url)
  on conflict (channel, external_id) do update set url = coalesce(public.public_store.url, excluded.url)
  returning id into store_id;
  select cs.account_id into acc from public.channel_store cs
   where cs.channel = 'ifood' and cs.external_id = p_external_id;
  insert into public.xray (account_id, target_store_id, radius_km, categories, rules, status, created_by)
  values (acc, store_id, p_radius_km, coalesce(p_categories, '{}'), coalesce(p_rules, '{}'), 'collecting', p_actor)
  returning id into new_id;
  perform app.audit_staff(p_actor, acc, 'xray.create', 'xray', new_id, null,
    jsonb_build_object('target_store_id', store_id, 'radius_km', p_radius_km, 'categories', p_categories,
                       'rules', p_rules),
    p_ip, p_user_agent);
  return new_id;
end $$;

-- C03: a founder puts a store in or out of the set; the reason becomes "manual" (kept when rules rerun).
create function public.xray_store_set_included(
  p_xray_store uuid, p_included boolean,
  p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  prev public.xray_store;
  acc uuid;
begin
  perform app.require_staff(p_actor);
  select * into prev from public.xray_store where id = p_xray_store for update;
  if not found then
    raise exception 'unknown neighborhood store' using errcode = 'no_data_found';
  end if;
  select account_id into acc from public.xray where id = prev.xray_id;
  update public.xray_store set included = p_included, exclusion_reason = 'manual' where id = p_xray_store;
  perform app.audit_staff(p_actor, acc, 'xray_store.set_included', 'xray_store', p_xray_store,
    jsonb_build_object('included', prev.included, 'exclusion_reason', prev.exclusion_reason),
    jsonb_build_object('included', p_included, 'exclusion_reason', 'manual'),
    p_ip, p_user_agent);
end $$;

-- Status changes a founder asks for. p_from lists the statuses the change may start from.
create function app.xray_step(
  p_xray uuid, p_action text, p_from public.xray_status[], p_to public.xray_status,
  p_actor uuid, p_extra jsonb, p_ip inet, p_user_agent text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
begin
  perform app.require_staff(p_actor);
  select * into x from public.xray where id = p_xray for update;
  if not found then
    raise exception 'unknown X-ray' using errcode = 'no_data_found';
  end if;
  if not (x.status = any (p_from)) then
    raise exception 'X-ray in % cannot %', x.status, p_action using errcode = 'check_violation';
  end if;
  if p_to is not null and p_to <> x.status then
    update public.xray set status = p_to,
                           delivered_at = case when p_to = 'delivered' then now() else delivered_at end
     where id = p_xray;
  elsif p_to = 'delivered' then
    update public.xray set delivered_at = now() where id = p_xray;
  end if;
  perform app.audit_staff(p_actor, x.account_id, p_action, 'xray', p_xray,
    jsonb_build_object('status', x.status),
    jsonb_build_object('status', coalesce(p_to, x.status)) || coalesce(p_extra, '{}'),
    p_ip, p_user_agent);
end $$;

-- C03 "Confirmar N lojas": pairing starts (the web app enqueues xray_pair).
create function public.xray_confirm_stores(
  p_xray uuid, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  select count(*) into n from public.xray_store where xray_id = p_xray and included;
  if n = 0 then
    raise exception 'no store in the set' using errcode = 'check_violation';
  end if;
  perform app.xray_step(p_xray, 'xray.confirm_stores', array['collecting', 'pairing', 'ready', 'delivered']::public.xray_status[],
                        'pairing', p_actor, jsonb_build_object('stores_in_set', n), p_ip, p_user_agent);
end $$;

-- C04: a founder decides the pairs of one item; the item counts as reviewed.
create function public.xray_item_review(
  p_item uuid, p_accepted uuid[],
  p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  it public.xray_item;
  acc uuid;
  before_ids uuid[];
  after_ids uuid[];
begin
  perform app.require_staff(p_actor);
  select * into it from public.xray_item where id = p_item for update;
  if not found then
    raise exception 'unknown X-ray item' using errcode = 'no_data_found';
  end if;
  select account_id into acc from public.xray where id = it.xray_id;
  select coalesce(array_agg(id order by id) filter (where accepted), '{}') into before_ids
    from public.xray_pair where xray_item_id = p_item;
  update public.xray_pair set accepted = (id = any (coalesce(p_accepted, '{}'))), by = p_actor
   where xray_item_id = p_item;
  select coalesce(array_agg(id order by id) filter (where accepted), '{}') into after_ids
    from public.xray_pair where xray_item_id = p_item;
  update public.xray_item set reviewed_by = p_actor, reviewed_at = now(), skipped = false where id = p_item;
  perform app.audit_staff(p_actor, acc, 'xray_item.review', 'xray_item', p_item,
    jsonb_build_object('accepted', before_ids, 'skipped', it.skipped),
    jsonb_build_object('accepted', after_ids, 'skipped', false),
    p_ip, p_user_agent);
end $$;

-- C04: skip an item; skipped items stay out of parity and are listed in the PDF footnote.
create function public.xray_item_set_skipped(
  p_item uuid, p_skipped boolean,
  p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  it public.xray_item;
  acc uuid;
begin
  perform app.require_staff(p_actor);
  select * into it from public.xray_item where id = p_item for update;
  if not found then
    raise exception 'unknown X-ray item' using errcode = 'no_data_found';
  end if;
  select account_id into acc from public.xray where id = it.xray_id;
  update public.xray_item set skipped = p_skipped where id = p_item;
  perform app.audit_staff(p_actor, acc, 'xray_item.set_skipped', 'xray_item', p_item,
    jsonb_build_object('skipped', it.skipped), jsonb_build_object('skipped', p_skipped), p_ip, p_user_agent);
end $$;

-- C04 "Calcular raio-X": refused while a `revisar` item is neither reviewed nor skipped.
create function public.xray_calculate(
  p_xray uuid, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.xray_item where xray_id = p_xray and pair_status = 'revisar'
                                                and reviewed_at is null and not skipped) then
    raise exception 'items still to review' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.xray_item where xray_id = p_xray) then
    raise exception 'pairing has not run' using errcode = 'check_violation';
  end if;
  perform app.xray_step(p_xray, 'xray.calculate', array['pairing', 'ready', 'delivered']::public.xray_status[],
                        null, p_actor, null, p_ip, p_user_agent);
end $$;

-- C05 "Preparar entrega": the web app enqueues render_xray (worker-render, P01).
create function public.xray_prepare_delivery(
  p_xray uuid, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.xray_step(p_xray, 'xray.prepare_delivery', array['ready', 'delivered']::public.xray_status[],
                        null, p_actor, null, p_ip, p_user_agent);
end $$;

-- C06 "Enviar pelo WhatsApp": manual send (D36); the X-ray is delivered.
create function public.xray_mark_delivered(
  p_xray uuid, p_message text, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.xray_step(p_xray, 'xray.deliver', array['ready', 'delivered']::public.xray_status[],
                        'delivered', p_actor, jsonb_build_object('message', p_message), p_ip, p_user_agent);
end $$;

-- C06 "Salvar e voltar": minutes per step for this person and X-ray (03 §2 time_log).
create function public.time_log_save(
  p_xray uuid, p_minutes jsonb, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  k text;
  v jsonb;
  before_rows jsonb;
begin
  perform app.require_staff(p_actor);
  select * into x from public.xray where id = p_xray;
  if not found then
    raise exception 'unknown X-ray' using errcode = 'no_data_found';
  end if;
  select coalesce(jsonb_object_agg(step, minutes), '{}') into before_rows
    from public.time_log where xray_id = p_xray and person_id = p_actor;
  for k, v in select * from jsonb_each(coalesce(p_minutes, '{}')) loop
    if k not in ('vizinhanca', 'pareamento', 'entrega') or jsonb_typeof(v) <> 'number' or v::numeric < 0
       or v::numeric <> trunc(v::numeric) then
      raise exception 'invalid time step %', k using errcode = 'invalid_parameter_value';
    end if;
    insert into public.time_log (account_id, xray_id, step, minutes, person_id)
    values (x.account_id, p_xray, k, v::int, p_actor)
    on conflict (xray_id, step, person_id) where xray_id is not null do update set minutes = excluded.minutes;
  end loop;
  perform app.audit_staff(p_actor, x.account_id, 'time_log.save', 'xray', p_xray, before_rows, p_minutes,
                          p_ip, p_user_agent);
end $$;

-- Service role only (see 20261031000005_flags.sql).
do $$
declare f text;
begin
  foreach f in array array[
    'app.require_staff(uuid)',
    'app.audit_staff(uuid, uuid, text, text, uuid, jsonb, jsonb, inet, text)',
    'app.xray_step(uuid, text, public.xray_status[], public.xray_status, uuid, jsonb, inet, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.xray_create(text, text, int, text[], jsonb, uuid, inet, text)',
    'public.xray_store_set_included(uuid, boolean, uuid, inet, text)',
    'public.xray_confirm_stores(uuid, uuid, inet, text)',
    'public.xray_item_review(uuid, uuid[], uuid, inet, text)',
    'public.xray_item_set_skipped(uuid, boolean, uuid, inet, text)',
    'public.xray_calculate(uuid, uuid, inet, text)',
    'public.xray_prepare_delivery(uuid, uuid, inet, text)',
    'public.xray_mark_delivered(uuid, text, uuid, inet, text)',
    'public.time_log_save(uuid, jsonb, uuid, inet, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
