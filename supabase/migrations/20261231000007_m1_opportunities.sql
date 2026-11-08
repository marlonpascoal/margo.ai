-- "Oportunidades" on the owner's X-ray result (P23; Marlon, 08/nov: the report must be more didactic, and opportunities
-- need not be fully deterministic, so an AI writes them on top of the deterministic rules). After a run is calculated,
-- worker-collector (job xray_opportunities) reads the run's facts (monitor_result and monitor_positions: M1-05 to M1-12),
-- asks the Claude API for 3 to 5 prioritized opportunities, and keeps only those that pass a deterministic check: every
-- number in them exists in the facts, no "lucro", "margem" or "ganho", no long dash, items of this run only.
--   xray_opportunity   one row per run, never updated: the validated opportunities (items), the hash of the facts sent,
--                      the model, the prompt version and how many answers the check dropped. A run whose answers all
--                      failed the check keeps a row with no items. No row: not generated (flag off, no API key, own runs
--                      only, or a run calculated before this migration).
-- Gated by the new flag m1.oportunidades_ia: sandbox on for every plan, production off for every plan.

insert into public.feature_flag (key, description, default_raio_x, default_lucro, default_rede, env)
select 'm1.oportunidades_ia', 'Oportunidades sugeridas por IA no resultado do raio-X', s = 'sandbox', s = 'sandbox', s = 'sandbox',
       s::public.flag_env
  from (values ('sandbox'), ('production')) e (s);

create table public.xray_opportunity (
  id uuid primary key default gen_random_uuid(),
  xray_id uuid not null unique references public.xray (id) on delete cascade,
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  facts_hash text not null,
  model text not null,
  prompt_version text not null,
  dropped int not null default 0 check (dropped >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.xray_opportunity is
  'P23 "Oportunidades": the AI opportunities of a run that passed the deterministic number check (worker-collector, job xray_opportunities). items: [{title, why, item_ids, lever}] in priority order. Never updated.';

create trigger immutable before update on public.xray_opportunity
  for each row execute function app.history_is_immutable();
alter table public.xray_opportunity enable row level security;
-- Console like the other run tables; the portal reads it through monitor_opportunities (service role).
create policy read on public.xray_opportunity for select to authenticated using (app.is_staff());

-- Queueing: once a run's calculation finishes (job xray_calc done; its positions are written by then), one
-- xray_opportunities job per run, for an own store with no row yet, when the flag is on for the account. The flag
-- environment is the monitoring's; a run outside a monitoring uses sandbox, like extract_queue_discover.
create function app.opportunities_queue(p_xray uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  env public.flag_env;
begin
  select * into x from public.xray where id = p_xray;
  if not found or x.status not in ('ready', 'delivered') or x.target_kind <> 'own'
     or exists (select 1 from public.xray_opportunity o where o.xray_id = p_xray) then
    return null;
  end if;
  env := coalesce((select m.env from public.xray_monitor m where m.id = x.monitor_id), 'sandbox');
  if not public.flag_enabled('m1.oportunidades_ia', x.account_id, env) then
    return null;
  end if;
  return app.extract_queue_job('xray_opportunities', jsonb_build_object('xray_id', p_xray), x.account_id,
                               'xray_opportunities:' || p_xray::text);
end $$;

create function app.opportunities_on_calc() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.opportunities_queue((new.payload ->> 'xray_id')::uuid);
  return null;
end $$;

create trigger opportunities_after_calc after update of status on public.job
  for each row
  when (new.type = 'xray_calc' and new.status = 'done' and old.status is distinct from new.status
        and new.payload ? 'xray_id')
  execute function app.opportunities_on_calc();

-- Loader -----------------------------------------------------------------------------------------------------------------

-- P23 "Oportunidades": the run's validated opportunities with the names of their items; null when none was generated.
create function public.monitor_opportunities(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'xray_id', o.xray_id, 'created_at', o.created_at, 'model', o.model, 'prompt_version', o.prompt_version,
    'dropped', o.dropped,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'rank', e.n, 'title', e.op ->> 'title', 'why', e.op ->> 'why', 'lever', e.op ->> 'lever',
        'items', (select coalesce(jsonb_agg(jsonb_build_object('item_id', v.id, 'name', v.name) order by r.k), '[]')
                    from jsonb_array_elements_text(coalesce(e.op -> 'item_ids', '[]')) with ordinality r (id, k)
                    join public.xray_item_view v on v.id::text = r.id and v.xray_id = o.xray_id))
        order by e.n), '[]')
        from jsonb_array_elements(o.items) with ordinality e (op, n)))
    from public.xray_opportunity o where o.xray_id = p_xray
$$;

revoke all on function app.opportunities_queue(uuid) from public, anon, authenticated;
revoke all on function app.opportunities_on_calc() from public, anon, authenticated;
revoke all on function public.monitor_opportunities(uuid) from public, anon, authenticated;
grant execute on function public.monitor_opportunities(uuid) to service_role;
