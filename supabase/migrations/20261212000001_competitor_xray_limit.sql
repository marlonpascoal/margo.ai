-- Competitor X-rays limited per plan (Marlon, 31/out, docs/build-review.md "X-ray of another store").
--
--   plan.competitor_xrays_per_month: X-rays of stores that are not the account's own (xray.target_kind
--     'competitor') an account may create per month, in São Paulo time. A plan field like billing_unit
--     (D40), edited in C15. Raio-X grátis 0, Lucro 3, Rede 10. The free trial uses the Lucro value, as
--     with the flags (04 §6, app.flag_plan_code).
--   flag m1.concorrente (04 §6): competitor X-rays for an account. Off in Raio-X, on in Lucro and Rede.
--   public.xray_create gains p_account (the account the X-ray is for; default: the owner of the target
--     store, else a lead without account, as before) and p_env (flag environment). When the X-ray is for
--     an account and its target is not one of that account's channel stores, the flag must be on and the
--     month's count below the plan limit, else it raises (P0001):
--       competitor_xray_not_in_plan   flag off for the account
--       competitor_xray_limit:<n>     n competitor X-rays this month already (n = plan limit)
--     The app maps both to Portuguese messages (apps/web/lib/xray/labels.ts). Leads have no limit.

alter table public.plan add column competitor_xrays_per_month int not null default 0
  check (competitor_xrays_per_month >= 0);
comment on column public.plan.competitor_xrays_per_month is
  'Competitor X-rays (xray.target_kind = competitor) per account per São Paulo month. Edited in C15 (D40 style).';

update public.plan set competitor_xrays_per_month = case code when 'lucro' then 3 when 'rede' then 10 else 0 end;

insert into public.feature_flag (key, description, default_raio_x, default_lucro, default_rede, env)
select 'm1.concorrente', 'Raio-X de loja concorrente', false, true, true, e.env
from (values ('sandbox'::public.flag_env), ('production'::public.flag_env)) as e (env);

-- Competitor X-rays of the account created in the current São Paulo month.
create function app.competitor_xrays_used(p_account uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.xray x
   where x.account_id = p_account and x.target_kind = 'competitor'
     and x.created_at >= (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
$$;

-- The account's monthly limit: its effective plan (trial counts as Lucro, 04 §6).
create function app.competitor_xray_limit(p_account uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.competitor_xrays_per_month from public.plan p where p.code = app.flag_plan_code(p_account)), 0)
$$;

drop function public.xray_create(text, text, int, text[], jsonb, uuid, inet, text);

create function public.xray_create(
  p_external_id text, p_url text, p_radius_km int, p_categories text[], p_rules jsonb,
  p_actor uuid, p_ip inet default null, p_user_agent text default null,
  p_account uuid default null, p_env public.flag_env default 'sandbox'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  store_id uuid;
  acc uuid;
  kind text;
  lim int;
  new_id uuid;
begin
  perform app.require_staff(p_actor);
  if p_external_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'the iFood store id is a uuid (D29)' using errcode = 'invalid_parameter_value';
  end if;
  if p_account is not null then
    if not exists (select 1 from public.account a where a.id = p_account) then
      raise exception 'unknown account' using errcode = 'no_data_found';
    end if;
    acc := p_account;
  else
    select cs.account_id into acc from public.channel_store cs
     where cs.channel = 'ifood' and cs.external_id = p_external_id;
  end if;

  if acc is not null then
    kind := case when exists (select 1 from public.channel_store cs
                               where cs.account_id = acc and cs.channel = 'ifood' and cs.external_id = p_external_id)
                 then 'own' else 'competitor' end;
    if kind = 'competitor' then
      -- One creation at a time per account, so two founders cannot both take the last one.
      perform pg_advisory_xact_lock(hashtextextended('competitor_xray:' || acc::text, 0));
      if not public.flag_enabled('m1.concorrente', acc, p_env) then
        raise exception 'competitor_xray_not_in_plan';
      end if;
      lim := app.competitor_xray_limit(acc);
      if app.competitor_xrays_used(acc) >= lim then
        raise exception 'competitor_xray_limit:%', lim;
      end if;
    end if;
  end if;

  insert into public.public_store (channel, external_id, url)
  values ('ifood', p_external_id, p_url)
  on conflict (channel, external_id) do update set url = coalesce(public.public_store.url, excluded.url)
  returning id into store_id;
  insert into public.xray (account_id, target_store_id, radius_km, categories, rules, status, created_by)
  values (acc, store_id, p_radius_km, coalesce(p_categories, '{}'), coalesce(p_rules, '{}'), 'collecting', p_actor)
  returning id, target_kind into new_id, kind;
  perform app.audit_staff(p_actor, acc, 'xray.create', 'xray', new_id, null,
    jsonb_build_object('target_store_id', store_id, 'radius_km', p_radius_km, 'categories', p_categories,
                       'rules', p_rules, 'target_kind', kind),
    p_ip, p_user_agent);
  return new_id;
end $$;

-- Service role only (as in 20261104000011).
revoke all on function public.xray_create(text, text, int, text[], jsonb, uuid, inet, text, uuid, public.flag_env)
  from public, anon, authenticated;
grant execute on function public.xray_create(text, text, int, text[], jsonb, uuid, inet, text, uuid, public.flag_env)
  to service_role;
revoke all on function app.competitor_xrays_used(uuid) from public, anon, authenticated;
revoke all on function app.competitor_xray_limit(uuid) from public, anon, authenticated;
