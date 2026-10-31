-- Feature flags (04 §6, D34): evaluation and the C20 change functions.
--
-- One evaluation in SQL, called through RPC by the web app (OpenFeature provider, apps/web/lib/flags)
-- and by the workers (workers/common/src/margo_common/flags.py), so TypeScript and Python never disagree.
-- Every function here runs with the service role only: the console checks staff.role before calling
-- the change functions, and they check it again.

-- The plan whose defaults apply to an account (04 §6, §7): Lucro during the free trial, else the
-- subscription's plan, else account.plan_id when the account has no subscription. Null: no plan.
create function app.flag_plan_code(p_account uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when s.status = 'trial' then 'lucro' else coalesce(sp.code, ap.code) end
  from public.account a
  left join public.subscription s on s.account_id = a.id
  left join public.plan sp on sp.id = s.plan_id
  left join public.plan ap on ap.id = a.plan_id
  where a.id = p_account
$$;

-- 04 §6 evaluation: the account's exception if any, else the plan default, for the given env.
-- Unknown key or unknown account: false. Null account (console screens and system jobs, which belong
-- to no account): on when the flag is on in at least one plan, since "off in all plans" means not launched.
create function public.flag_enabled(p_key text, p_account uuid, p_env public.flag_env) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select o.value from public.feature_override o
     where o.flag_key = p_key and o.env = p_env and o.account_id = p_account),
    (select case
       when p_account is null then f.default_raio_x or f.default_lucro or f.default_rede
       else case app.flag_plan_code(p_account)
         when 'raio_x' then f.default_raio_x
         when 'lucro' then f.default_lucro
         when 'rede' then f.default_rede
       end
     end
     from public.feature_flag f where f.key = p_key and f.env = p_env),
    false
  )
$$;
comment on function public.flag_enabled is '04 §6. Service role only; workers and the web provider call it via RPC (A05).';

-- C20 change functions ----------------------------------------------------------------------------

create function app.require_fundador(p_actor uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff s where s.person_id = p_actor and s.role = 'fundador') then
    raise exception 'only a fundador changes feature flags (04 §5)' using errcode = 'insufficient_privilege';
  end if;
end $$;

-- Sets one plan default. Writes feature_flag_log (account_id null) and audit_log; a call that changes
-- nothing writes nothing.
create function public.flag_set_default(
  p_key text, p_env public.flag_env, p_plan text, p_value boolean,
  p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.feature_flag;
  old_value boolean;
begin
  perform app.require_fundador(p_actor);
  if p_plan not in ('raio_x', 'lucro', 'rede') or p_value is null then
    raise exception 'invalid plan % or value', p_plan using errcode = 'invalid_parameter_value';
  end if;
  select * into f from public.feature_flag where key = p_key and env = p_env for update;
  if not found then
    raise exception 'unknown flag % in %', p_key, p_env using errcode = 'no_data_found';
  end if;
  old_value := case p_plan when 'raio_x' then f.default_raio_x when 'lucro' then f.default_lucro
                           else f.default_rede end;
  if old_value = p_value then
    return;
  end if;

  update public.feature_flag set
    default_raio_x = case when p_plan = 'raio_x' then p_value else default_raio_x end,
    default_lucro = case when p_plan = 'lucro' then p_value else default_lucro end,
    default_rede = case when p_plan = 'rede' then p_value else default_rede end
  where id = f.id;

  insert into public.feature_flag_log (flag_key, env, account_id, old, new, by)
  values (p_key, p_env, null, old_value, p_value, p_actor);
  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id,
                                before, after, ip, user_agent)
  values (p_actor, 'staff', null, 'flag_default_set', 'feature_flag', f.id,
          jsonb_build_object('key', p_key, 'env', p_env, 'plan', p_plan, 'value', old_value),
          jsonb_build_object('key', p_key, 'env', p_env, 'plan', p_plan, 'value', p_value),
          p_ip, p_user_agent);
end $$;

-- Adds or changes an account exception; the reason is required (C20). Log old/new are the stored
-- exception values, null meaning no exception.
create function public.flag_set_override(
  p_key text, p_env public.flag_env, p_account uuid, p_value boolean, p_reason text,
  p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  prev public.feature_override;
  saved public.feature_override;
begin
  perform app.require_fundador(p_actor);
  if p_value is null or nullif(btrim(p_reason), '') is null then
    raise exception 'an exception needs a value and a reason' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.feature_flag where key = p_key and env = p_env) then
    raise exception 'unknown flag % in %', p_key, p_env using errcode = 'no_data_found';
  end if;
  select * into prev from public.feature_override
  where flag_key = p_key and env = p_env and account_id = p_account for update;

  insert into public.feature_override (flag_key, env, account_id, value, reason, set_by)
  values (p_key, p_env, p_account, p_value, btrim(p_reason), p_actor)
  on conflict (flag_key, env, account_id)
    do update set value = excluded.value, reason = excluded.reason, set_by = excluded.set_by
  returning * into saved;

  insert into public.feature_flag_log (flag_key, env, account_id, old, new, by)
  values (p_key, p_env, p_account, prev.value, p_value, p_actor);
  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id,
                                before, after, ip, user_agent)
  values (p_actor, 'staff', p_account, 'flag_exception_set', 'feature_override', saved.id,
          case when prev.id is null then null
               else jsonb_build_object('key', p_key, 'env', p_env, 'value', prev.value, 'reason', prev.reason) end,
          jsonb_build_object('key', p_key, 'env', p_env, 'value', saved.value, 'reason', saved.reason),
          p_ip, p_user_agent);
end $$;

-- Removes an account exception; the account falls back to its plan default. No exception: no-op.
create function public.flag_remove_override(
  p_key text, p_env public.flag_env, p_account uuid,
  p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  prev public.feature_override;
begin
  perform app.require_fundador(p_actor);
  delete from public.feature_override
  where flag_key = p_key and env = p_env and account_id = p_account
  returning * into prev;
  if prev.id is null then
    return;
  end if;

  insert into public.feature_flag_log (flag_key, env, account_id, old, new, by)
  values (p_key, p_env, p_account, prev.value, null, p_actor);
  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id,
                                before, after, ip, user_agent)
  values (p_actor, 'staff', p_account, 'flag_exception_removed', 'feature_override', prev.id,
          jsonb_build_object('key', p_key, 'env', p_env, 'value', prev.value, 'reason', prev.reason),
          null, p_ip, p_user_agent);
end $$;

-- Service role only. Supabase grants execute on new public functions to anon and authenticated by
-- default; take it back. The app helpers stay private to these functions.
revoke all on function app.flag_plan_code(uuid) from public, anon, authenticated;
revoke all on function app.require_fundador(uuid) from public, anon, authenticated;
revoke all on function public.flag_enabled(text, uuid, public.flag_env) from public, anon, authenticated;
revoke all on function public.flag_set_default(text, public.flag_env, text, boolean, uuid, inet, text)
  from public, anon, authenticated;
revoke all on function public.flag_set_override(text, public.flag_env, uuid, boolean, text, uuid, inet, text)
  from public, anon, authenticated;
revoke all on function public.flag_remove_override(text, public.flag_env, uuid, uuid, inet, text)
  from public, anon, authenticated;
grant execute on function public.flag_enabled(text, uuid, public.flag_env) to service_role;
grant execute on function public.flag_set_default(text, public.flag_env, text, boolean, uuid, inet, text)
  to service_role;
grant execute on function public.flag_set_override(text, public.flag_env, uuid, boolean, text, uuid, inet, text)
  to service_role;
grant execute on function public.flag_remove_override(text, public.flag_env, uuid, uuid, inet, text)
  to service_role;
