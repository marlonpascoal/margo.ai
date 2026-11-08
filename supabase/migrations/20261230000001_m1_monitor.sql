-- M1 owner journey: monitorings of own stores and competitors, run by themselves (docs/m1-owner-journey-draft.md,
-- approved direction, Marlon 07/nov). Every value marked PROVISIONAL answers an open question of the draft with its
-- proposed default and lives in a param, a flag or notice_type data, so changing it is data, not code.
--
--   xray_monitor               an account's standing order: watch this store (own or competitor), near this kitchen,
--                              every N days, with radius, categories and C02 rules; status active, paused_by_person,
--                              paused_by_plan or removed (history kept)
--   xray.monitor_id            each run is an ordinary xray of the monitoring; null for leads and console X-rays
--   monitor_pair_decision      the owner's answers ("é o mesmo" / "nenhum é o mesmo"), per monitoring and pair of
--                              public_menu_item ids (catalog rows are never deleted, so the ids are stable); applied on
--                              later runs through public.xray_pair_decisions, as M1-04 applies a founder's decision
--   public.monitor_queue_due   from the daily extract cron: plan limits, then the due runs. A run copies the previous
--                              run's store set (ranks and capture places, M1-11 unchanged) between discoveries, every
--                              m1.monitor_rediscover_days (28)
--   app.monitor_on_job         trigger on public.job: a monitored run pairs by itself once xray_pair_blocker allows
--                              (90% of captures, M1-04), then calculates with the open doubts as skipped; answers
--                              recalculate
--   monitor_create, _pause, _resume, _remove, _set_period, _answer, _answer_many, _confirm_suggestions, _undo
--                              the audited writes (A04), permissions checked here (04 §5 + draft §2.1)
--   monitor_summaries, _limits, _progress, _doubts, _items, _result, _history, _item_history, _partial
--                              the loaders of P19 to P24 (service role, after the portal's own RLS read of the monitor)
--   flag m1.portal             PROVISIONAL (Q5): on in sandbox, off in production, all plans
--   notices xray_ready, xray_needs_answer  PROVISIONAL (Q8): Dono and Gerente (kitchen filter in the sending code)
--
-- PROVISIONAL params (draft §7):
--   m1.monitor_count_month_starts (1)        Q2: competitor monitorings started per São Paulo month also count against
--                                            plan.competitor_xrays_per_month; 0 keeps only the active limit
--   m1.monitor_own_max_<plan>                Q3: own monitorings active at once; raio_x 1, no row = no limit
--   m1.monitor_min_every_days_<plan>         Q3: shortest period; raio_x 90, lucro and rede 7
--   m1.portal_gerente_answers (1)            Q1: a Gerente answers doubts of monitorings of their kitchens
--   m1.portal_competitor_doubts_asked (0)    Q4: doubts of a competitor run are not asked (listed, "Revisar mesmo assim")
--   m1.portal_show_store_names (1)           Q7: neighborhood stores by name; 0 shows "Loja vizinha NN"
--   m1.capture_typical_seconds (50), m1.portal_pace_window_minutes (15), m1.portal_slow_minutes (5)  P21 time range
-- Active competitor monitorings are limited by plan.competitor_xrays_per_month too (0/3/10), as Marlon asked.

-- Params, flag, notices ---------------------------------------------------------------------------------------------

insert into public.rule_param (key, value, description) values
  ('m1.monitor_rediscover_days', 28, 'M1 monitoring: days between discoveries of a monitored store; between them a run reuses the previous store set'),
  ('m1.monitor_count_month_starts', 1, 'PROVISIONAL (draft Q2): 1 also limits competitor monitorings started per São Paulo month by plan.competitor_xrays_per_month; 0 only the active ones'),
  ('m1.monitor_own_max_raio_x', 1, 'PROVISIONAL (draft Q3): own-store monitorings active at once on the Raio-X plan; a plan without this param has no limit'),
  ('m1.monitor_min_every_days_raio_x', 90, 'PROVISIONAL (draft Q3): shortest monitoring period in days on the Raio-X plan'),
  ('m1.monitor_min_every_days_lucro', 7, 'M1 monitoring: shortest period in days on the Lucro plan and trial'),
  ('m1.monitor_min_every_days_rede', 7, 'M1 monitoring: shortest period in days on the Rede plan'),
  ('m1.portal_gerente_answers', 1, 'PROVISIONAL (draft Q1): 1 lets a Gerente answer doubts of monitorings of their kitchens'),
  ('m1.portal_competitor_doubts_asked', 0, 'PROVISIONAL (draft Q4): 1 asks the owner the doubts of a competitor run; 0 lists them as optional'),
  ('m1.portal_show_store_names', 1, 'PROVISIONAL (draft Q7): 1 names neighborhood stores to owners; 0 shows "Loja vizinha NN"'),
  ('m1.capture_typical_seconds', 50, 'P21: seconds per capture assumed while fewer than 3 captures of the run finished'),
  ('m1.portal_pace_window_minutes', 15, 'P21: minutes of capture pace behind the time range'),
  ('m1.portal_slow_minutes', 5, 'P21: minutes without a finished capture before the screen says the reading is slower');

insert into public.feature_flag (key, description, default_raio_x, default_lucro, default_rede, env)
select 'm1.portal', 'Raio-X no portal do dono: acompanhamentos, leitura, dúvidas e resultado', e.is_on, e.is_on, e.is_on, e.env
from (values ('sandbox'::public.flag_env, true), ('production'::public.flag_env, false)) as e (env, is_on);

insert into public.notice_type (code, name, audience_roles, email_locked, default_email, default_whatsapp) values
  ('xray_ready', 'Seu raio-X está pronto', array['dono', 'gerente'], false, true, true),
  ('xray_needs_answer', 'Itens esperando sua resposta', array['dono', 'gerente'], false, true, false);

-- Tables ---------------------------------------------------------------------------------------------------------------

create type public.monitor_status as enum ('active', 'paused_by_person', 'paused_by_plan', 'removed');

create table public.xray_monitor (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  target_store_id uuid not null references public.public_store (id),
  target_kind text not null check (target_kind in ('own', 'competitor')),
  kitchen_id uuid,
  every_days int not null check (every_days between 1 and 365),
  radius_km int not null default 3 check (radius_km in (2, 3, 5)),
  categories text[] not null default '{}',
  rules jsonb not null default '{}',
  status public.monitor_status not null default 'active',
  env public.flag_env not null default 'sandbox',
  next_run_at timestamptz,
  last_xray_id uuid,
  discovered_at timestamptz,
  created_by uuid references public.person (id) on delete set null,
  updated_by uuid references public.person (id) on delete set null,
  paused_at timestamptz,
  paused_by uuid references public.person (id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, kitchen_id) references public.kitchen (account_id, id) on delete set null (kitchen_id),
  check ((status = 'removed') = (removed_at is not null))
);
comment on table public.xray_monitor is
  'M1 owner journey: a standing order to read a store and its neighborhood every N days. Each run is an xray with monitor_id.';
comment on column public.xray_monitor.kitchen_id is
  'Own store: its kitchen. Competitor: "perto de qual cozinha", which drives the Gerente scope. Null: only people who see all kitchens.';
comment on column public.xray_monitor.every_days is
  'The period the Dono chose; a run waits the longer of it and m1.monitor_min_every_days_<plan>, so a plan change needs no rewrite.';
comment on column public.xray_monitor.env is 'Flag environment of the server that created it (04 §6), for the job triggers.';
create unique index xray_monitor_one_per_store on public.xray_monitor (account_id, target_store_id) where status <> 'removed';
create index xray_monitor_due on public.xray_monitor (next_run_at) where status = 'active';

alter table public.xray add column monitor_id uuid references public.xray_monitor (id) on delete set null;
comment on column public.xray.monitor_id is 'The monitoring this run belongs to; null for leads and one-off console X-rays.';
create index xray_monitor_runs on public.xray (monitor_id, created_at desc) where monitor_id is not null;
alter table public.xray_monitor add foreign key (last_xray_id) references public.xray (id) on delete set null;

create table public.monitor_pair_decision (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null,
  account_id uuid not null references public.account (id) on delete cascade,
  own_item_id uuid not null references public.public_menu_item (id),
  candidate_item_id uuid not null references public.public_menu_item (id),
  accepted boolean not null,
  decided_by uuid references public.person (id) on delete set null,
  decided_at timestamptz not null default now(),
  xray_id uuid references public.xray (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (monitor_id, own_item_id, candidate_item_id),
  foreign key (account_id, monitor_id) references public.xray_monitor (account_id, id) on delete cascade
);
comment on table public.monitor_pair_decision is
  'M1-04: an owner''s answer on one pair, remembered per monitoring and applied on every later run while the store is in the set.';

do $$
declare t text;
begin
  foreach t in array array['xray_monitor', 'monitor_pair_decision'] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function app.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- RLS: 04 §5 "See price X-ray": Dono and Financeiro, Gerente own kitchens only. No write policy.
create function app.sees_monitor(p_monitor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.xray_monitor m where m.id = p_monitor and app.sees_kitchen(m.account_id, m.kitchen_id))
$$;
create policy read on public.xray_monitor for select to authenticated
  using (app.is_staff() or app.sees_kitchen(account_id, kitchen_id));
create policy read on public.monitor_pair_decision for select to authenticated
  using (app.is_staff() or app.sees_monitor(monitor_id));
create policy read_monitor_run on public.xray for select to authenticated
  using (monitor_id is not null and app.sees_monitor(monitor_id));

-- Helpers --------------------------------------------------------------------------------------------------------------

create function app.monitor_param(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.value from public.rule_param p where p.key = p_key), p_default)
$$;

-- The account's effective plan: trial counts as Lucro (04 §6, app.flag_plan_code).
create function app.monitor_min_every_days(p_account uuid) returns int
language sql stable security definer set search_path = '' as $$
  select app.monitor_param('m1.monitor_min_every_days_' || coalesce(app.flag_plan_code(p_account), 'raio_x'), 7)::int
$$;

create function app.monitor_own_max(p_account uuid) returns int
language sql stable security definer set search_path = '' as $$
  select p.value::int from public.rule_param p
   where p.key = 'm1.monitor_own_max_' || coalesce(app.flag_plan_code(p_account), 'raio_x')
$$;

-- Competitor monitorings at once and started per month: plan.competitor_xrays_per_month, 0 when m1.concorrente is off.
create function app.monitor_competitor_max(p_account uuid, p_env public.flag_env) returns int
language sql stable security definer set search_path = '' as $$
  select case when public.flag_enabled('m1.concorrente', p_account, p_env) then app.competitor_xray_limit(p_account) else 0 end
$$;

create function app.monitor_month_start() returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
$$;

create function app.monitor_usage(p_account uuid, out own_active int, out competitor_active int, out competitor_started_month int)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where m.target_kind = 'own' and m.status = 'active')::int,
         count(*) filter (where m.target_kind = 'competitor' and m.status = 'active')::int,
         count(*) filter (where m.target_kind = 'competitor' and m.created_at >= app.monitor_month_start())::int
    from public.xray_monitor m where m.account_id = p_account
$$;

create function app.monitor_effective_days(p_monitor public.xray_monitor) returns int
language sql stable security definer set search_path = '' as $$
  select greatest(p_monitor.every_days, app.monitor_min_every_days(p_monitor.account_id))
$$;

-- Draft §2.1: start, pause, resume, remove and change the period are Dono only; staff may act for support.
create function app.monitor_manager(p_account uuid, p_actor uuid) returns public.actor_kind
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.membership m where m.account_id = p_account and m.person_id = p_actor and m.role = 'dono') then
    return 'person';
  end if;
  if exists (select 1 from public.staff s where s.person_id = p_actor) then
    return 'staff';
  end if;
  raise exception 'monitor_not_allowed' using errcode = 'insufficient_privilege';
end $$;

-- Draft §2.1: who answers doubts. Dono; a Gerente for monitorings of their kitchens (PROVISIONAL, m1.portal_gerente_answers);
-- staff for support. Financeiro only sees.
create function app.monitor_answerer(p_monitor public.xray_monitor, p_actor uuid) returns public.actor_kind
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.membership m where m.account_id = p_monitor.account_id and m.person_id = p_actor
              and (m.role = 'dono'
                   or (m.role = 'gerente' and app.monitor_param('m1.portal_gerente_answers', 1) = 1
                       and p_monitor.kitchen_id is not null
                       and (m.all_kitchens or exists (select 1 from public.membership_kitchen mk
                                                       where mk.membership_id = m.id and mk.kitchen_id = p_monitor.kitchen_id))))) then
    return 'person';
  end if;
  if exists (select 1 from public.staff s where s.person_id = p_actor) then
    return 'staff';
  end if;
  raise exception 'monitor_not_allowed' using errcode = 'insufficient_privilege';
end $$;

create function app.monitor_audit(
  p_actor uuid, p_kind public.actor_kind, p_account uuid, p_action text, p_entity text, p_entity_id uuid,
  p_before jsonb, p_after jsonb, p_ip inet, p_user_agent text
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, before, after, ip, user_agent)
  values (p_actor, p_kind, p_account, p_action, p_entity, p_entity_id, p_before, p_after, p_ip, p_user_agent)
$$;

create function app.monitor_row(p_monitor uuid) returns public.xray_monitor
language plpgsql security definer set search_path = '' as $$
declare
  m public.xray_monitor;
begin
  select * into m from public.xray_monitor where id = p_monitor for update;
  if not found then
    raise exception 'unknown monitoring' using errcode = 'no_data_found';
  end if;
  return m;
end $$;

-- Runs -----------------------------------------------------------------------------------------------------------------

-- A monitored run pairs by itself (M1-04, Marlon 07/nov) once the neighborhood exists and public.xray_pair_blocker allows:
-- the run goes to pairing and the xray_pair job is queued. Returns the job, or null when nothing was queued.
create function app.monitor_advance(p_xray uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  m public.xray_monitor;
begin
  select * into x from public.xray where id = p_xray for update;
  if not found or x.monitor_id is null or x.status <> 'collecting' then
    return null;
  end if;
  select * into m from public.xray_monitor where id = x.monitor_id;
  if not public.flag_enabled('m1.portal', x.account_id, m.env) then
    return null;
  end if;
  if exists (select 1 from public.job j where j.type = 'extract_discover' and j.status in ('queued', 'running')
              and j.payload ->> 'xray_id' = p_xray::text)
     or not exists (select 1 from public.xray_store xs where xs.xray_id = p_xray)
     or public.xray_pair_blocker(p_xray) is not null then
    return null;
  end if;
  update public.xray set status = 'pairing' where id = p_xray;
  return app.extract_queue_job('xray_pair', jsonb_build_object('xray_id', p_xray), x.account_id, 'xray_pair:' || p_xray::text);
end $$;

create function app.monitor_queue_calc(p_xray uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  acc uuid;
  jid uuid;
begin
  select account_id into acc from public.xray where id = p_xray;
  jid := app.extract_queue_job('xray_calc', jsonb_build_object('xray_id', p_xray), acc, 'xray_calc:' || p_xray::text);
  if jid is null then
    select j.id into jid from public.job j where j.type = 'xray_calc' and j.dedupe_key = 'xray_calc:' || p_xray::text
       and j.status in ('queued', 'running');
  end if;
  return jid;
end $$;

-- After pairing: an item whose every pair a person decided (here or remembered by the monitoring) counts as reviewed
-- (M1-05: parity from fewer stores, as for a founder); the doubts still open stay out of the calculation as skipped
-- until answered (draft §2.6 "Not blocking"). Then the calculation.
create function app.monitor_after_pair(p_xray uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.xray where id = p_xray and monitor_id is not null) then
    return null;
  end if;
  update public.xray_item i
     set reviewed_by = (select p.by from public.xray_pair p where p.xray_item_id = i.id and p.by is not null
                         order by p.updated_at desc, p.id limit 1),
         reviewed_at = now(), skipped = false
   where i.xray_id = p_xray and i.pair_status = 'revisar' and i.reviewed_at is null
     and exists (select 1 from public.xray_pair p where p.xray_item_id = i.id)
     and not exists (select 1 from public.xray_pair p where p.xray_item_id = i.id and p.by is null);
  update public.xray_item i set skipped = true
   where i.xray_id = p_xray and i.pair_status = 'revisar' and i.reviewed_at is null and not i.skipped
     and exists (select 1 from public.xray_pair p where p.xray_item_id = i.id);
  return app.monitor_queue_calc(p_xray);
end $$;

-- One run of a monitoring, at p_at. With a discovery due (first run, settings changed, or older than
-- m1.monitor_rediscover_days) the discovery is queued; otherwise the previous run's store set is copied with its ranks,
-- capture places and manual choices, the due captures are queued and pairing may start at once.
create function app.monitor_start_run(p_monitor uuid, p_actor uuid, p_at timestamptz, p_force_discover boolean) returns uuid
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
    perform public.extract_queue_discover(xid, m.env);
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

-- Job trigger: captures and the neighborhood move a collecting run toward pairing; a finished pairing calculates; a
-- refused pairing (load came back) returns the run to collecting, to start again at the next capture.
create function app.monitor_on_job() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  xid uuid;
  sid uuid;
begin
  if new.type = 'extract_capture' then
    sid := (new.payload ->> 'public_store_id')::uuid;
    for xid in
      select v.id from public.xray v
       where v.monitor_id is not null and v.status = 'collecting'
         and (v.target_store_id = sid
              or exists (select 1 from public.xray_store xs where xs.xray_id = v.id and xs.public_store_id = sid and xs.capture_slot))
    loop
      perform app.monitor_advance(xid);
    end loop;
    return null;
  end if;
  xid := (new.payload ->> 'xray_id')::uuid;
  if xid is null then
    return null;
  end if;
  if new.type = 'xray_neighborhood' then
    perform app.monitor_advance(xid);
  elsif new.type = 'xray_pair' and new.status = 'done' then
    perform app.monitor_after_pair(xid);
  elsif new.type = 'xray_pair' then
    update public.xray set status = 'collecting' where id = xid and monitor_id is not null and status = 'pairing';
  end if;
  return null;
end $$;

create trigger monitor_jobs after update of status on public.job
  for each row
  when (new.status in ('done', 'failed') and old.status is distinct from new.status
        and new.type in ('extract_capture', 'xray_neighborhood', 'xray_pair'))
  execute function app.monitor_on_job();

-- M1-04 hook for worker-collector (repo.pair_decisions): the decisions of this run, then the monitoring's remembered
-- answers for pairs this run has not decided. Founder decisions keep working as before.
create function public.xray_pair_decisions(p_xray uuid)
returns table (own_item_id uuid, candidate_item_id uuid, accepted boolean, decided_by uuid)
language sql stable security definer set search_path = '' as $$
  with run as (
    select i.public_menu_item_id as own, p.public_menu_item_id as cand, p.accepted, p.by
      from public.xray_pair p join public.xray_item i on i.id = p.xray_item_id
     where i.xray_id = p_xray and p.by is not null
  )
  select own, cand, accepted, by from run
  union all
  select d.own_item_id, d.candidate_item_id, d.accepted, d.decided_by
    from public.monitor_pair_decision d join public.xray x on x.monitor_id = d.monitor_id
   where x.id = p_xray and d.decided_by is not null
     and not exists (select 1 from run r where r.own = d.own_item_id and r.cand = d.candidate_item_id)
$$;

-- Plan limits ------------------------------------------------------------------------------------------------------------

-- Draft §3.3: a downgrade pauses (paused_by_plan), never deletes, the newest first; an upgrade resumes the oldest first,
-- within the limits. paused_by_person stays as the person left it. Audited as the system.
create function app.monitor_apply_plan(p_account uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  env public.flag_env;
  lim int;
  r record;
  n int := 0;
  kind text;
  active int;
begin
  select m.env into env from public.xray_monitor m where m.account_id = p_account limit 1;
  if env is null then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('monitor:' || p_account::text, 0));
  foreach kind in array array['competitor', 'own'] loop
    lim := case kind when 'competitor' then app.monitor_competitor_max(p_account, env) else app.monitor_own_max(p_account) end;
    for r in
      select m.id from public.xray_monitor m
       where m.account_id = p_account and m.target_kind = kind and m.status = 'active'
       order by m.created_at, m.id offset coalesce(lim, 2147483647)
    loop
      update public.xray_monitor set status = 'paused_by_plan', paused_at = now(), paused_by = null where id = r.id;
      perform app.monitor_audit(null, 'system', p_account, 'monitor.paused_by_plan', 'xray_monitor', r.id,
        '{"status": "active"}', '{"status": "paused_by_plan"}', null, null);
      n := n + 1;
    end loop;
    select count(*) into active from public.xray_monitor m
     where m.account_id = p_account and m.target_kind = kind and m.status = 'active';
    for r in
      select m.id from public.xray_monitor m
       where m.account_id = p_account and m.target_kind = kind and m.status = 'paused_by_plan'
       order by m.created_at, m.id limit greatest(coalesce(lim, 2147483647) - active, 0)
    loop
      update public.xray_monitor set status = 'active', paused_at = null, paused_by = null,
             next_run_at = greatest(coalesce(next_run_at, now()), now())
       where id = r.id;
      perform app.monitor_audit(null, 'system', p_account, 'monitor.resumed_by_plan', 'xray_monitor', r.id,
        '{"status": "paused_by_plan"}', '{"status": "active"}', null, null);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

create function app.monitor_plan_changed_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.monitor_apply_plan(new.id);
  return null;
end $$;
create function app.monitor_plan_changed_subscription() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.monitor_apply_plan(new.account_id);
  return null;
end $$;
create trigger monitor_plan after update of plan_id on public.account
  for each row when (old.plan_id is distinct from new.plan_id) execute function app.monitor_plan_changed_account();
create trigger monitor_plan after insert or update of plan_id, status on public.subscription
  for each row execute function app.monitor_plan_changed_subscription();

-- Daily cron (/api/cron/extract, before the captures): plan limits, then a new run for each active monitoring due,
-- with m1.portal and m1.raio_x on for its account. A run still collecting or pairing postpones the next one by a day.
create function public.monitor_queue_due(p_env public.flag_env default 'sandbox', p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare
  acc uuid;
  m public.xray_monitor;
  n int := 0;
begin
  for acc in select distinct account_id from public.xray_monitor where status in ('active', 'paused_by_plan') loop
    perform app.monitor_apply_plan(acc);
  end loop;
  for m in
    select * from public.xray_monitor
     where status = 'active' and env = p_env and next_run_at <= p_now order by next_run_at, id
  loop
    if not public.flag_enabled('m1.portal', m.account_id, p_env) or not public.flag_enabled('m1.raio_x', m.account_id, p_env) then
      continue;
    end if;
    if exists (select 1 from public.xray x where x.id = m.last_xray_id and x.status in ('collecting', 'pairing')) then
      update public.xray_monitor set next_run_at = p_now + interval '1 day' where id = m.id;
      continue;
    end if;
    perform app.monitor_start_run(m.id, null, p_now, false);
    n := n + 1;
  end loop;
  return n;
end $$;

-- D47c "active X-ray": as in 20261225000001, except the runs of a monitoring that is not active (paused or removed stops
-- captures, draft §3.2).
create or replace function public.extract_queue_due(p_env public.flag_env default 'sandbox', p_now timestamptz default now())
returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    with latest as (
      select distinct on (x.target_store_id) x.*
        from public.xray x where x.status <> 'draft'
       order by x.target_store_id, x.created_at desc
    )
    select l.id from latest l left join public.account a on a.id = l.account_id
     where not coalesce(a.is_synthetic, false) and not (l.account_id is null and l.status = 'delivered')
       and not exists (select 1 from public.xray_monitor mm where mm.id = l.monitor_id and mm.status <> 'active')
  loop
    perform app.xray_capture_fill(r.id);
  end loop;
  for r in
    with latest as (
      select distinct on (x.target_store_id) x.*
        from public.xray x where x.status <> 'draft'
       order by x.target_store_id, x.created_at desc
    ), active as (
      select l.* from latest l left join public.account a on a.id = l.account_id
       where not coalesce(a.is_synthetic, false) and not (l.account_id is null and l.status = 'delivered')
         and not exists (select 1 from public.xray_monitor mm where mm.id = l.monitor_id and mm.status <> 'active')
    ), stores as (
      select a.target_store_id as store_id, a.account_id, 0 as ord from active a
      union all
      select xs.public_store_id, a.account_id, 1 from active a
        join public.xray_store xs on xs.xray_id = a.id and xs.included and xs.capture_slot
    )
    select distinct on (s.store_id) s.store_id, s.account_id
      from stores s
     where public.flag_enabled('m1.extracao', s.account_id, p_env)
     order by s.store_id, s.ord
  loop
    if app.extract_capture_due(r.store_id, p_now) and app.extract_queue_capture(r.store_id, r.account_id) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Console competitor X-rays keep their own monthly count (20261212000001); runs of monitorings are counted by
-- monitor_create instead.
create or replace function app.competitor_xrays_used(p_account uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.xray x
   where x.account_id = p_account and x.target_kind = 'competitor' and x.monitor_id is null
     and x.created_at >= (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
$$;

-- Writes (A04: each in one transaction with audit_log) --------------------------------------------------------------------

-- P20 "Começar a acompanhar": the monitoring and its first run (discovery queued). Refusals (P0001 unless noted):
--   monitor_not_enabled                  m1.portal or m1.raio_x off for the account
--   monitor_not_allowed (42501)          the actor is not Dono of the account (nor staff)
--   monitor_bad_store                    not an iFood store uuid (D29)
--   monitor_bad_kitchen                  the kitchen is not of this account
--   monitor_exists:<id>                  the account already monitors this store
--   monitor_min_every_days:<n>           the period is shorter than the plan allows
--   competitor_xray_not_in_plan          a competitor with m1.concorrente off
--   monitor_competitor_limit:<n>         n competitor monitorings active already
--   monitor_competitor_month_limit:<n>   n competitor monitorings started this São Paulo month already
--   monitor_own_limit:<n>                n own-store monitorings active already
create function public.monitor_create(
  p_account uuid, p_external_id text, p_url text, p_kitchen uuid, p_every_days int, p_radius_km int,
  p_categories text[], p_rules jsonb, p_actor uuid, p_env public.flag_env default 'sandbox',
  p_ip inet default null, p_user_agent text default null
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
  if p_external_id is null or p_external_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'monitor_bad_store';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('monitor:' || p_account::text, 0));
  select cs.kitchen_id into kitchen from public.channel_store cs
   where cs.account_id = p_account and cs.channel = 'ifood' and cs.external_id = p_external_id;
  kind := case when found then 'own' else 'competitor' end;
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

-- P19 row menu: "Pausar", "Retomar", "Remover". Resume checks the limits again; a monitoring paused by the plan resumes
-- only with the plan (monitor_paused_by_plan). Removing keeps every run.
create function public.monitor_set_status(
  p_monitor uuid, p_action text, p_actor uuid, p_env public.flag_env default 'sandbox',
  p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.xray_monitor;
  who public.actor_kind;
  u record;
  lim int;
begin
  m := app.monitor_row(p_monitor);
  who := app.monitor_manager(m.account_id, p_actor);
  perform pg_advisory_xact_lock(hashtextextended('monitor:' || m.account_id::text, 0));
  if p_action = 'pause' then
    if m.status <> 'active' then
      raise exception 'monitor_not_active';
    end if;
    update public.xray_monitor set status = 'paused_by_person', paused_at = now(), paused_by = p_actor, updated_by = p_actor
     where id = m.id;
  elsif p_action = 'resume' then
    if m.status = 'paused_by_plan' then
      raise exception 'monitor_paused_by_plan';
    elsif m.status <> 'paused_by_person' then
      raise exception 'monitor_not_paused';
    end if;
    select * into u from app.monitor_usage(m.account_id);
    if m.target_kind = 'competitor' then
      lim := app.monitor_competitor_max(m.account_id, p_env);
      if u.competitor_active >= lim then
        raise exception 'monitor_competitor_limit:%', lim;
      end if;
    else
      lim := app.monitor_own_max(m.account_id);
      if lim is not null and u.own_active >= lim then
        raise exception 'monitor_own_limit:%', lim;
      end if;
    end if;
    update public.xray_monitor set status = 'active', paused_at = null, paused_by = null, updated_by = p_actor,
           next_run_at = greatest(coalesce(next_run_at, now()), now())
     where id = m.id;
  elsif p_action = 'remove' then
    if m.status = 'removed' then
      raise exception 'monitor_removed';
    end if;
    update public.xray_monitor set status = 'removed', removed_at = now(), removed_by = p_actor, updated_by = p_actor
     where id = m.id;
  else
    raise exception 'unknown monitor action %', p_action using errcode = 'invalid_parameter_value';
  end if;
  perform app.monitor_audit(p_actor, who, m.account_id, 'monitor.' || p_action, 'xray_monitor', m.id,
    jsonb_build_object('status', m.status),
    (select jsonb_build_object('status', x.status) from public.xray_monitor x where x.id = m.id), p_ip, p_user_agent);
end $$;

-- P19 "Mudar frequência": at least the plan's shortest period; the next run moves with it.
create function public.monitor_set_period(
  p_monitor uuid, p_every_days int, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.xray_monitor;
  who public.actor_kind;
  min_days int;
  last_at timestamptz;
begin
  m := app.monitor_row(p_monitor);
  who := app.monitor_manager(m.account_id, p_actor);
  if m.status = 'removed' then
    raise exception 'monitor_removed';
  end if;
  min_days := app.monitor_min_every_days(m.account_id);
  if p_every_days is null or p_every_days < min_days or p_every_days > 365 then
    raise exception 'monitor_min_every_days:%', min_days;
  end if;
  select x.created_at into last_at from public.xray x where x.id = m.last_xray_id;
  update public.xray_monitor
     set every_days = p_every_days, updated_by = p_actor,
         next_run_at = coalesce(last_at, now()) + make_interval(days => greatest(p_every_days, min_days))
   where id = m.id;
  perform app.monitor_audit(p_actor, who, m.account_id, 'monitor.set_period', 'xray_monitor', m.id,
    jsonb_build_object('every_days', m.every_days), jsonb_build_object('every_days', p_every_days), p_ip, p_user_agent);
end $$;

-- P22 "Sim, é o mesmo" (p_accepted: the xray_pair ids marked) or "Nenhum é o mesmo" (empty). Writes the run's pairs, the
-- item as reviewed and the monitoring's memory. p_if_unanswered refuses an item someone already answered
-- (monitor_already_answered, "Outra pessoa já respondeu este item"). Returns the run.
create function app.monitor_answer_one(
  p_item uuid, p_accepted uuid[], p_actor uuid, p_if_unanswered boolean, p_ip inet, p_user_agent text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  it public.xray_item;
  x public.xray;
  m public.xray_monitor;
  who public.actor_kind;
  before_ids uuid[];
  after_ids uuid[];
begin
  select * into it from public.xray_item where id = p_item for update;
  if not found then
    raise exception 'unknown X-ray item' using errcode = 'no_data_found';
  end if;
  select * into x from public.xray where id = it.xray_id;
  if x.monitor_id is null then
    raise exception 'monitor_not_a_monitored_run';
  end if;
  select * into m from public.xray_monitor where id = x.monitor_id;
  who := app.monitor_answerer(m, p_actor);
  if p_if_unanswered and it.reviewed_at is not null then
    raise exception 'monitor_already_answered';
  end if;
  if exists (select 1 from unnest(coalesce(p_accepted, '{}')) a
              where not exists (select 1 from public.xray_pair p where p.id = a and p.xray_item_id = p_item)) then
    raise exception 'monitor_unknown_pair' using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(array_agg(p.public_menu_item_id order by p.public_menu_item_id) filter (where p.accepted), '{}') into before_ids
    from public.xray_pair p where p.xray_item_id = p_item;
  update public.xray_pair set accepted = (id = any (coalesce(p_accepted, '{}'))), by = p_actor where xray_item_id = p_item;
  update public.xray_item set reviewed_by = p_actor, reviewed_at = now(), skipped = false where id = p_item;
  insert into public.monitor_pair_decision (monitor_id, account_id, own_item_id, candidate_item_id, accepted, decided_by,
                                            decided_at, xray_id)
  select m.id, m.account_id, it.public_menu_item_id, p.public_menu_item_id, p.accepted, p_actor, now(), x.id
    from public.xray_pair p where p.xray_item_id = p_item
  on conflict (monitor_id, own_item_id, candidate_item_id) do update
    set accepted = excluded.accepted, decided_by = excluded.decided_by, decided_at = excluded.decided_at, xray_id = excluded.xray_id;
  select coalesce(array_agg(p.public_menu_item_id order by p.public_menu_item_id) filter (where p.accepted), '{}') into after_ids
    from public.xray_pair p where p.xray_item_id = p_item;
  perform app.monitor_audit(p_actor, who, m.account_id, 'monitor.answer', 'xray_item', p_item,
    jsonb_build_object('monitor_id', m.id, 'own_item_id', it.public_menu_item_id, 'accepted', before_ids,
                       'reviewed', it.reviewed_at is not null),
    jsonb_build_object('monitor_id', m.id, 'own_item_id', it.public_menu_item_id, 'accepted', after_ids,
                       'candidates', (select coalesce(jsonb_agg(p.public_menu_item_id order by p.public_menu_item_id), '[]')
                                        from public.xray_pair p where p.xray_item_id = p_item)),
    p_ip, p_user_agent);
  return x.id;
end $$;

-- One answer; the calculation runs again. Returns the xray_calc job to wake.
create function public.monitor_answer(
  p_item uuid, p_accepted uuid[], p_actor uuid, p_if_unanswered boolean default false,
  p_ip inet default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  return app.monitor_queue_calc(app.monitor_answer_one(p_item, p_accepted, p_actor, p_if_unanswered, p_ip, p_user_agent));
end $$;

-- P22 bulk: p_answers = [{"item": uuid, "accepted": [pair uuid, ...]}, ...], all of one run; one calculation.
create function public.monitor_answer_many(
  p_xray uuid, p_answers jsonb, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a jsonb;
  xid uuid;
begin
  for a in select v from jsonb_array_elements(coalesce(p_answers, '[]')) v loop
    xid := app.monitor_answer_one((a ->> 'item')::uuid,
      array(select jsonb_array_elements_text(coalesce(a -> 'accepted', '[]'))::uuid), p_actor, false, p_ip, p_user_agent);
    if xid <> p_xray then
      raise exception 'monitor_item_of_other_run' using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return app.monitor_queue_calc(p_xray);
end $$;

-- P22 suggestion of a doubt: the candidate M1-04 ranks first (highest similarity, then catalog id). PROVISIONAL: one
-- candidate; Stage 2 may offer several.
create function app.monitor_suggestion(p_item uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.xray_pair p where p.xray_item_id = p_item
   order by p.similarity desc, p.public_menu_item_id limit 1
$$;

-- P22 "Confirmar todas as sugestões" (p_items null: every open doubt of the run) and "Confirmar sugestões dos selecionados".
create function public.monitor_confirm_suggestions(
  p_xray uuid, p_items uuid[], p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  iid uuid;
begin
  for iid in
    select i.id from public.xray_item i
     where i.xray_id = p_xray and i.pair_status = 'revisar' and i.reviewed_at is null
       and (p_items is null or i.id = any (p_items))
       and exists (select 1 from public.xray_pair p where p.xray_item_id = i.id)
     order by i.id
  loop
    perform app.monitor_answer_one(iid, array[app.monitor_suggestion(iid)], p_actor, false, p_ip, p_user_agent);
  end loop;
  return app.monitor_queue_calc(p_xray);
end $$;

-- Undo an answer: the monitoring forgets the item's decisions, the run pairs it again by the rules (xray_pair job, then
-- the calculation through the job trigger). Returns the xray_pair job to wake.
create function public.monitor_undo(
  p_item uuid, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  it public.xray_item;
  x public.xray;
  m public.xray_monitor;
  who public.actor_kind;
  forgotten jsonb;
  jid uuid;
begin
  select * into it from public.xray_item where id = p_item for update;
  if not found then
    raise exception 'unknown X-ray item' using errcode = 'no_data_found';
  end if;
  select * into x from public.xray where id = it.xray_id;
  if x.monitor_id is null then
    raise exception 'monitor_not_a_monitored_run';
  end if;
  select * into m from public.xray_monitor where id = x.monitor_id;
  who := app.monitor_answerer(m, p_actor);
  with gone as (
    delete from public.monitor_pair_decision d where d.monitor_id = m.id and d.own_item_id = it.public_menu_item_id
    returning d.candidate_item_id, d.accepted
  )
  select coalesce(jsonb_agg(jsonb_build_object('candidate_item_id', candidate_item_id, 'accepted', accepted)), '[]')
    into forgotten from gone;
  update public.xray_pair set by = null where xray_item_id = p_item;
  update public.xray_item set reviewed_by = null, reviewed_at = null where id = p_item;
  update public.xray set status = 'pairing' where id = x.id and status in ('collecting', 'ready');
  jid := app.extract_queue_job('xray_pair', jsonb_build_object('xray_id', x.id), x.account_id, 'xray_pair:' || x.id::text);
  perform app.monitor_audit(p_actor, who, m.account_id, 'monitor.undo', 'xray_item', p_item,
    jsonb_build_object('monitor_id', m.id, 'own_item_id', it.public_menu_item_id, 'decisions', forgotten),
    jsonb_build_object('monitor_id', m.id, 'own_item_id', it.public_menu_item_id, 'decisions', '[]'::jsonb),
    p_ip, p_user_agent);
  return jid;
end $$;

-- Loaders (service role; the portal reads the monitoring with RLS first) -----------------------------------------------------

-- Draft §6: a neighborhood store as owners see it. The target and, with m1.portal_show_store_names = 1, every store by
-- name; otherwise "Loja vizinha NN" by its M1-11 rank in the run.
create function app.monitor_store_label(p_xray uuid, p_store uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when app.monitor_param('m1.portal_show_store_names', 1) = 1
      or exists (select 1 from public.xray x where x.id = p_xray and x.target_store_id = p_store)
    then (select s.name from public.public_store s where s.id = p_store)
    else 'Loja vizinha ' || coalesce(lpad((select xs.capture_rank from public.xray_store xs
                                           where xs.xray_id = p_xray and xs.public_store_id = p_store)::text, 2, '0'), '')
  end
$$;

-- Marlon's rule for every screen (07/nov): items are shown by category, never as one flat list. The group of an item is
-- its M1-04 Stage 1 category (xray_item.item_category), "so_seus" when nothing nearby is comparable, "sem_categoria" when
-- pairing named none. Order as the screens list them.
create function app.monitor_item_group(p_category text, p_comparables bigint) returns text
language sql immutable set search_path = '' as $$
  select case when p_comparables = 0 then 'so_seus' else coalesce(p_category, 'sem_categoria') end
$$;
create function app.monitor_group_order(p_group text) returns int
language sql immutable set search_path = '' as $$
  select coalesce(array_position(array['bebidas', 'lanches', 'porcoes', 'pratos', 'sobremesas', 'adicionais',
                                       'sem_categoria', 'so_seus'], p_group), 99)
$$;

-- P21 "parcial": an item name compared exactly, ignoring case, accents and spacing.
create function app.monitor_name_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select trim(regexp_replace(lower(translate(p_name, 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
                                                     'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')), '\s+', ' ', 'g'))
$$;

-- P21 per store: the state of its capture for this run, from its newest capture job: done, failed, running, queued,
-- retry_wait (with retry_at) or beyond_cap (M1-11).
create function app.monitor_capture_rows(p_xray uuid)
returns table (public_store_id uuid, is_target boolean, state text, retry_at timestamptz, finished_at timestamptz,
               distance_m int, left_out boolean)
language sql stable security definer set search_path = '' as $$
  select s.public_store_id, s.is_target,
         case when s.state <> 'missing' then s.state
              when j.status = 'running' then 'running'
              when j.not_before > now() then 'retry_wait'
              else 'queued' end,
         case when s.state = 'missing' and j.status = 'queued' and j.not_before > now() then j.not_before end,
         case when s.state in ('done', 'failed') then j.finished_at end,
         xs.distance_m, coalesce(xs.left_out_of_pairing, false)
    from public.xray_capture_states(p_xray) s
    left join lateral (
      select jb.status, jb.not_before, jb.finished_at from public.job jb
       where jb.type = 'extract_capture' and jb.payload ->> 'public_store_id' = s.public_store_id::text
       order by jb.created_at desc, jb.id desc limit 1) j on true
    left join public.xray_store xs on xs.xray_id = p_xray and xs.public_store_id = s.public_store_id
$$;

-- P21 / W12 and the progress endpoint: step, counts by state, stores, pace inputs for the time range (computed in
-- apps/web/lib/monitor/rules.ts), errors. No competitor price here.
create function public.monitor_progress(p_xray uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  x public.xray;
  m public.xray_monitor;
  q record;
  step text;
  window_min int := app.monitor_param('m1.portal_pace_window_minutes', 15)::int;
begin
  select * into x from public.xray where id = p_xray;
  if not found then
    return null;
  end if;
  select * into m from public.xray_monitor where id = x.monitor_id;
  select * into q from public.xray_pair_quorum(p_xray);
  step := case
    when x.status in ('ready', 'delivered') then 'ready'
    when exists (select 1 from public.job j where j.type = 'xray_calc' and j.status in ('queued', 'running')
                  and j.payload ->> 'xray_id' = p_xray::text) then 'calc'
    when x.status = 'pairing' then 'pair'
    when exists (select 1 from public.job j where j.type in ('extract_discover', 'xray_neighborhood', 'collect')
                  and j.status in ('queued', 'running') and j.payload ->> 'xray_id' = p_xray::text)
      or not exists (select 1 from public.xray_store xs where xs.xray_id = p_xray) then 'discover'
    else 'capture' end;
  return (
    with rows as (select * from app.monitor_capture_rows(p_xray)),
    stores as (
      select r.*, app.monitor_store_label(p_xray, r.public_store_id) as name,
             case when r.state = 'done' then (select count(*) from public.public_menu_item mi
                                                where mi.public_store_id = r.public_store_id and mi.removed_at is null) end as items
        from rows r
    )
    select jsonb_build_object(
      'xray_id', x.id, 'monitor_id', x.monitor_id, 'status', x.status, 'step', step, 'created_at', x.created_at,
      'counts', jsonb_build_object(
        'done', (select count(*) from rows where state = 'done'),
        'running', (select count(*) from rows where state = 'running'),
        'queued', (select count(*) from rows where state = 'queued'),
        'retry_wait', (select count(*) from rows where state = 'retry_wait'),
        'failed', (select count(*) from rows where state = 'failed'),
        'beyond_cap', (select count(*) from rows where state = 'beyond_cap'),
        'total', (select count(*) from rows where state <> 'beyond_cap')),
      'quorum', jsonb_build_object('finished', q.finished, 'total', q.total, 'required', q.required),
      'blocker', public.xray_pair_blocker(p_xray),
      'stores_found', (select count(*) from public.xray_store xs where xs.xray_id = p_xray),
      'stores_chosen', (select count(*) from rows where state <> 'beyond_cap' and not is_target),
      'items_read', (select coalesce(sum(items), 0) from stores where not is_target),
      'target', (select jsonb_build_object('state', s.state, 'retry_at', s.retry_at) from stores s where s.is_target),
      'stores', (select coalesce(jsonb_agg(jsonb_build_object(
                   'public_store_id', s.public_store_id, 'name', s.name, 'is_target', s.is_target, 'state', s.state,
                   'retry_at', s.retry_at, 'distance_m', s.distance_m, 'items', s.items, 'left_out', s.left_out)
                   order by s.is_target desc, s.distance_m nulls last, s.public_store_id), '[]') from stores s),
      'pace', jsonb_build_object(
        'finished_since_start', (select count(*) from rows where finished_at >= x.created_at),
        'finished_in_window', (select count(*) from rows where finished_at >= now() - make_interval(mins => window_min)),
        'last_finished_at', (select max(finished_at) from rows where finished_at >= x.created_at),
        'latest_retry_at', (select max(retry_at) from rows),
        'window_minutes', window_min,
        'typical_seconds', app.monitor_param('m1.capture_typical_seconds', 50),
        'slow_minutes', app.monitor_param('m1.portal_slow_minutes', 5),
        'max_running', app.monitor_param('m1.extract_max_running', 20)),
      'errors', jsonb_build_object(
        'discover_failed', exists (select 1 from public.job j where j.type = 'extract_discover' and j.status = 'failed'
                                    and j.payload ->> 'xray_id' = p_xray::text)
                           and not exists (select 1 from public.xray_store xs where xs.xray_id = p_xray),
        'target_failed', exists (select 1 from rows where is_target and state = 'failed'),
        'extraction_off', not public.flag_enabled('m1.extracao', x.account_id, coalesce(m.env, 'sandbox'))),
      'now', now())
  );
end $$;

-- P22 / W13: the doubtful items with their candidates and the suggestion, and the counts of the header.
create function public.monitor_doubts(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (select * from public.xray where id = p_xray),
  items as (
    select i.*, (select count(*) from public.xray_pair p where p.xray_item_id = i.id) as n_pairs,
           exists (select 1 from public.xray_pair p where p.xray_item_id = i.id and p.accepted) as any_accepted
      from public.xray_item i where i.xray_id = p_xray
  )
  select jsonb_build_object(
    'xray_id', p_xray,
    'asked', not ((select target_kind from x) = 'competitor' and app.monitor_param('m1.portal_competitor_doubts_asked', 0) = 0),
    'auto_confirmed', (select count(*) from items where pair_status <> 'revisar' and any_accepted),
    'open', (select count(*) from items where pair_status = 'revisar' and n_pairs > 0 and reviewed_at is null),
    'answered', (select count(*) from items where pair_status = 'revisar' and n_pairs > 0 and reviewed_at is not null),
    'only_yours', (select count(*) from items where n_pairs = 0),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('group', g, 'open', o, 'answered', a)
                      order by app.monitor_group_order(g)), '[]')
                      from (select app.monitor_item_group(item_category, n_pairs) as g,
                                   count(*) filter (where reviewed_at is null) as o,
                                   count(*) filter (where reviewed_at is not null) as a
                              from items where pair_status = 'revisar' and n_pairs > 0 group by 1) c),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'own_item_id', i.public_menu_item_id, 'name', v.name, 'own_cents', v.own_cents,
        'category', i.item_category, 'group', app.monitor_item_group(i.item_category, i.n_pairs),
        'unit', v.unit, 'unit_qty', v.unit_qty, 'pair_note', i.pair_note, 'item_category', i.item_category,
        'answered', i.reviewed_at is not null, 'answered_at', i.reviewed_at,
        'answered_by', (select pe.name from public.person pe where pe.id = i.reviewed_by),
        'answered_by_staff', exists (select 1 from public.staff st where st.person_id = i.reviewed_by),
        'stores', (select count(distinct pm.public_store_id) from public.xray_pair p
                     join public.public_menu_item pm on pm.id = p.public_menu_item_id where p.xray_item_id = i.id),
        'candidates', (select coalesce(jsonb_agg(jsonb_build_object(
            'pair_id', p.id, 'name', pm.name, 'store', app.monitor_store_label(p_xray, pm.public_store_id),
            'price_cents', coalesce(sn.price_cents, pm.comparison_price_cents), 'unit', pm.unit, 'unit_qty', pm.unit_qty,
            'accepted', p.accepted, 'suggested', p.id = app.monitor_suggestion(i.id))
            order by p.similarity desc, pm.public_store_id, pm.id), '[]')
            from public.xray_pair p join public.public_menu_item pm on pm.id = p.public_menu_item_id
            left join public.public_menu_item_snapshot sn on sn.xray_id = p_xray and sn.public_menu_item_id = pm.id
           where p.xray_item_id = i.id))
        order by app.monitor_group_order(app.monitor_item_group(i.item_category, i.n_pairs)), i.reviewed_at nulls first,
                 v.name collate "C", i.id), '[]')
        from items i join public.xray_item_view v on v.id = i.id
       where i.pair_status = 'revisar' and i.n_pairs > 0)
  )
$$;

-- P22 collapsed sections: "Itens só seus" (no comparable item at all) and "Confirmados pelo sistema" (items with an
-- accepted pair that are not open doubts), each confirmed item with its accepted candidates for "Não é o mesmo".
create function public.monitor_items(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with v as (
    select v.*, i.item_category, app.monitor_item_group(i.item_category, v.comparables) as grp
      from public.xray_item_view v join public.xray_item i on i.id = v.id where v.xray_id = p_xray
  ),
  conf as (select * from v where v.accepted_pairs > 0 and (v.pair_status <> 'revisar' or v.reviewed_at is not null))
  select jsonb_build_object(
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('group', g, 'only_yours', o, 'confirmed', c)
                      order by app.monitor_group_order(g)), '[]')
                      from (select grp as g, count(*) filter (where comparables = 0) as o,
                                   count(*) filter (where id in (select id from conf)) as c
                              from v group by grp) t where o + c > 0),
    'only_yours', (select coalesce(jsonb_agg(jsonb_build_object('item_id', v.id, 'name', v.name, 'own_cents', v.own_cents,
                                                                'category', v.item_category, 'group', v.grp)
                     order by v.name collate "C", v.id), '[]')
                     from v where v.comparables = 0),
    'confirmed', (select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', v.id, 'name', v.name, 'own_cents', v.own_cents, 'parity_cents', v.parity_cents,
        'category', v.item_category, 'group', v.grp,
        'by_system', not exists (select 1 from public.xray_pair p where p.xray_item_id = v.id and p.by is not null),
        'accepted', (select coalesce(jsonb_agg(jsonb_build_object(
            'pair_id', p.id, 'name', pm.name, 'store', app.monitor_store_label(p_xray, pm.public_store_id),
            'price_cents', coalesce(sn.price_cents, pm.comparison_price_cents)) order by pm.name collate "C", p.id), '[]')
            from public.xray_pair p join public.public_menu_item pm on pm.id = p.public_menu_item_id
            left join public.public_menu_item_snapshot sn on sn.xray_id = p_xray and sn.public_menu_item_id = pm.id
           where p.xray_item_id = v.id and p.accepted))
        order by app.monitor_group_order(v.grp), v.name collate "C", v.id), '[]')
        from conf v)
  )
$$;

-- P23 / W14: everything P01 shows, from the same rule outputs the render job reads (margo_render.handlers.load_report,
-- report_items_m1_09), so the screen and the PDF cannot disagree: date, radius, stores compared (included stores), items,
-- analyzed items (not skipped, with parity), the KPIs, the top 3 to raise (M1-09: pode_subir by loss, shown most below
-- first), the "não mexa" items (most above first, by the higher of the two gaps), the Pareto count (M1-08), the items
-- left out and the method note; plus the M1-10 position, the doubts still open and the capture coverage.
create function public.monitor_result(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (
    select v.*, s.name as store_name, coalesce(a.is_synthetic, false) as synthetic
      from public.xray v join public.public_store s on s.id = v.target_store_id
      left join public.account a on a.id = v.account_id where v.id = p_xray
  ),
  it as (
    select i.id, v.name, v.own_cents, i.parity_cents, i.gap_pct, i.reading, i.loss_cents, i.skipped, i.pareto_rank,
           i.pareto_cum_share, i.parity_full_cents, i.gap_full_pct, i.full_price_room, i.public_menu_item_id,
           not i.skipped and i.parity_cents is not null as analyzed, i.item_category,
           app.monitor_item_group(i.item_category, v.comparables) as grp,
           greatest(coalesce(i.gap_pct, 0), coalesce(i.gap_full_pct, coalesce(i.gap_pct, 0))) as highest_gap
      from public.xray_item i join public.xray_item_view v on v.id = i.id where i.xray_id = p_xray
  ),
  strip as (
    select p.xray_item_id,
           min(app.per_base_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty)
               * coalesce(om.unit_qty, 1)) as low,
           max(app.per_base_m1_03(coalesce(sn.price_cents, pm.comparison_price_cents), pm.unit, pm.unit_qty)
               * coalesce(om.unit_qty, 1)) as high,
           count(distinct pm.public_store_id) as stores
      from public.xray_pair p join public.xray_item i on i.id = p.xray_item_id
      join public.public_menu_item om on om.id = i.public_menu_item_id
      join public.public_menu_item pm on pm.id = p.public_menu_item_id
      left join public.public_menu_item_snapshot sn on sn.xray_id = p_xray and sn.public_menu_item_id = pm.id
     where i.xray_id = p_xray and p.accepted
     group by p.xray_item_id
  ),
  up as (
    select * from it where analyzed and reading = 'pode_subir'
     order by coalesce(loss_cents, 0) desc, name collate "C" limit 3
  ),
  rank_now as (select r.* from public.xray_store_rank r join x on x.id = r.xray_id and r.is_target),
  prev as (
    select v.id from public.xray v join x on v.monitor_id = x.monitor_id
     where v.id <> x.id and v.created_at < x.created_at and v.status in ('ready', 'delivered')
     order by v.created_at desc limit 1
  ),
  rank_prev as (select r.* from public.xray_store_rank r join prev on prev.id = r.xray_id and r.is_target),
  caps as (select * from app.monitor_capture_rows(p_xray)),
  item_json as (
    select it.*, jsonb_build_object(
      'item_id', it.id, 'name', it.name, 'own_cents', it.own_cents, 'parity_cents', it.parity_cents,
      'gap_pct', it.gap_pct, 'reading', it.reading, 'loss_cents', it.loss_cents,
      'parity_full_cents', it.parity_full_cents, 'gap_full_pct', it.gap_full_pct, 'full_price_room', it.full_price_room,
      'pareto_rank', it.pareto_rank, 'pareto_cum_share', it.pareto_cum_share,
      'low_cents', round(s.low)::bigint, 'high_cents', round(s.high)::bigint, 'stores', s.stores,
      'category', it.item_category, 'group', it.grp) as j
      from it left join strip s on s.xray_item_id = it.id
  )
  select jsonb_build_object(
    'xray_id', x.id, 'monitor_id', x.monitor_id, 'status', x.status, 'target_kind', x.target_kind,
    'store_name', coalesce(x.store_name, 'Loja'), 'synthetic', x.synthetic,
    -- Cache key of a printed copy: the run row changes on every status step, the items on every calculation.
    'version', md5(x.updated_at::text || coalesce((select max(i.updated_at)::text from public.xray_item i where i.xray_id = x.id), '')),
    'on', (x.collected_at at time zone 'America/Sao_Paulo')::date, 'created_at', x.created_at,
    'radius_km', x.radius_km,
    'reading_band', coalesce((x.rules ->> 'reading_band')::numeric, 0.1),
    'stores_compared', (select count(*) from public.xray_store xs where xs.xray_id = x.id and xs.included),
    'items_total', (select count(*) from it),
    'items_analyzed', (select count(*) from it where analyzed),
    'below', (select count(*) from it where analyzed and reading = 'pode_subir'),
    'above', (select count(*) from it where analyzed and reading = 'nao_mexer'),
    'top_raise', (select coalesce(jsonb_agg(j.j order by j.gap_pct, j.name collate "C"), '[]')
                    from item_json j where j.id in (select id from up)),
    'dont_lower', (select coalesce(jsonb_agg(j.j order by j.highest_gap desc, j.name collate "C"), '[]')
                     from item_json j where j.analyzed and j.reading = 'nao_mexer'),
    'items', (select coalesce(jsonb_agg(j.j order by case j.reading when 'pode_subir' then 0 when 'na_media' then 1 else 2 end,
                                         abs(coalesce(j.gap_pct, 0)) desc, j.name collate "C"), '[]')
                from item_json j where j.analyzed),
    -- Per category (Marlon, 07/nov): items in the group, items compared, can go up, leave alone, and the price gap per
    -- sale ("diferença de preço por venda"): the sum of (parity minus own price) over the pode_subir items. No cost, no volume.
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object(
        'group', g.grp, 'items', g.n, 'items_compared', g.compared, 'can_go_up', g.up, 'leave_alone', g.hold,
        'at_average', g.avg, 'price_gap_per_sale_cents', g.price_gap) order by app.monitor_group_order(g.grp)), '[]')
        from (select grp, count(*) as n, count(*) filter (where analyzed) as compared,
                     count(*) filter (where analyzed and reading = 'pode_subir') as up,
                     count(*) filter (where analyzed and reading = 'nao_mexer') as hold,
                     count(*) filter (where analyzed and reading = 'na_media') as avg,
                     coalesce(sum(parity_cents - own_cents) filter (where analyzed and reading = 'pode_subir'), 0)::bigint as price_gap
                from it group by grp) g),
    'pareto_count', coalesce((select pareto_rank from it where pareto_rank is not null and pareto_cum_share >= 0.8
                               order by pareto_rank limit 1), 0),
    'left_out_items', (select coalesce(jsonb_agg(name order by name collate "C"), '[]') from it where skipped),
    'method_note', 'Fonte: cardápios públicos no iFood. Paridade = mediana dos itens comparáveis em ' || x.radius_km
                   || ' km. Sem dado de custo.',
    'position', (select jsonb_build_object('rank', r.rank, 'stores_ranked', r.stores_ranked, 'price_index', r.price_index,
                                           'items_compared', r.items_compared) from rank_now r),
    'previous_position', (select jsonb_build_object('xray_id', r.xray_id, 'rank', r.rank, 'stores_ranked', r.stores_ranked)
                            from rank_prev r),
    'doubts_open', (select count(*) from public.xray_item i where i.xray_id = x.id and i.pair_status = 'revisar'
                      and i.reviewed_at is null and exists (select 1 from public.xray_pair p where p.xray_item_id = i.id)),
    'only_yours', (select count(*) from public.xray_item_view v where v.xray_id = x.id and v.comparables = 0),
    'stores_read', (select count(*) from caps where state = 'done' and not is_target),
    'stores_total', (select count(*) from caps where state <> 'beyond_cap' and not is_target),
    'stores_left_out', (select count(*) from caps where left_out and not is_target)
  ) from x
$$;

-- P24 / W15: the runs of a monitoring with their M1-10 position, oldest first. Paused weeks are simply absent.
create function public.monitor_history(p_monitor uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'xray_id', x.id, 'created_at', x.created_at, 'on', (x.collected_at at time zone 'America/Sao_Paulo')::date,
    'status', x.status,
    'stores_read', (select count(*) from public.public_store_snapshot s where s.xray_id = x.id and s.public_store_id <> x.target_store_id),
    'items_compared', (select count(*) from public.xray_item i where i.xray_id = x.id and i.parity_cents is not null and not i.skipped),
    'rank', r.rank, 'stores_ranked', r.stores_ranked, 'price_index', r.price_index)
    order by x.created_at, x.id), '[]')
    from public.xray x left join public.xray_store_rank r on r.xray_id = x.id and r.is_target
   where x.monitor_id = p_monitor
$$;

-- P24 "preço por item ao longo do tempo": the target's item (public_menu_item id) per run, own price of that run and the
-- neighborhood parity. Competitor lines come with the screens (draft §2.8).
create function public.monitor_item_history(p_monitor uuid, p_item uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'xray_id', x.id, 'on', (x.collected_at at time zone 'America/Sao_Paulo')::date,
    'own_cents', coalesce(sn.price_cents, case when i.id is not null then v.own_cents end),
    'parity_cents', i.parity_cents, 'reading', i.reading, 'category', i.item_category)
    order by x.created_at, x.id), '[]')
    from public.xray x
    left join public.public_menu_item_snapshot sn on sn.xray_id = x.id and sn.public_menu_item_id = p_item
    left join public.xray_item i on i.xray_id = x.id and i.public_menu_item_id = p_item
    left join public.xray_item_view v on v.id = i.id
   where x.monitor_id = p_monitor and x.status in ('ready', 'delivered')
$$;

-- P24 item picker: the target's items of the newest calculated run, by category.
create function public.monitor_item_picker(p_monitor uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (
    select x.id from public.xray x where x.monitor_id = p_monitor and x.status in ('ready', 'delivered')
     order by x.created_at desc limit 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'own_item_id', i.public_menu_item_id, 'name', v.name, 'category', i.item_category,
    'group', app.monitor_item_group(i.item_category, v.comparables))
    order by app.monitor_group_order(app.monitor_item_group(i.item_category, v.comparables)), v.name collate "C", i.id), '[]')
    from r join public.xray_item i on i.xray_id = r.id join public.xray_item_view v on v.id = i.id
$$;

-- P21 "enquanto isso" (partial, before any comparison): the stores read with their item count, and the owner's items
-- with how many stores read list the same name exactly. No price of another store.
create function public.monitor_partial(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (select * from public.xray where id = p_xray),
  read as (select public_store_id, distance_m from app.monitor_capture_rows(p_xray) where state = 'done' and not is_target),
  names as (
    select distinct mi.public_store_id, app.monitor_name_key(mi.name) as k
      from public.public_menu_item mi join read r on r.public_store_id = mi.public_store_id where mi.removed_at is null
  ),
  -- Before this run pairs, an item's category is the one its last paired run of the monitoring gave it (M1-04 Stage 1
  -- runs in worker-collector); null for a first run.
  own as (
    select mi.id, mi.name, (select i.item_category from public.xray_item i join public.xray px on px.id = i.xray_id
                             where i.public_menu_item_id = mi.id and px.monitor_id = (select monitor_id from x)
                             order by px.created_at desc limit 1) as category,
           (select count(*) from names n where n.k = app.monitor_name_key(mi.name)) as stores
      from public.public_menu_item mi join x on x.target_store_id = mi.public_store_id where mi.removed_at is null
  )
  select jsonb_build_object(
    'stores_found', (select count(*) from public.xray_store xs where xs.xray_id = p_xray),
    'stores_read', (select coalesce(jsonb_agg(jsonb_build_object(
        'public_store_id', r.public_store_id, 'name', app.monitor_store_label(p_xray, r.public_store_id),
        'distance_m', r.distance_m,
        'items', (select count(*) from public.public_menu_item mi where mi.public_store_id = r.public_store_id and mi.removed_at is null))
        order by r.distance_m nulls last, r.public_store_id), '[]') from read r),
    'own_items', (select coalesce(jsonb_agg(jsonb_build_object(
        'own_item_id', o.id, 'name', o.name, 'category', o.category, 'group', coalesce(o.category, 'sem_categoria'),
        'stores', o.stores)
        order by app.monitor_group_order(coalesce(o.category, 'sem_categoria')), o.name collate "C", o.id), '[]') from own o),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('group', g, 'items', n, 'found_nearby', f)
                      order by app.monitor_group_order(g)), '[]')
                      from (select coalesce(category, 'sem_categoria') as g, count(*) as n, count(*) filter (where stores > 0) as f
                              from own group by 1) c)
  )
$$;

-- P19 / W10 rows: per monitoring, the newest run and its progress, the open doubts and the M1-10 position of the newest
-- calculated run with its change since the one before.
create function public.monitor_summaries(p_monitors uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'monitor_id', m.id, 'status', m.status, 'target_kind', m.target_kind, 'kitchen_id', m.kitchen_id,
    'store_name', s.name, 'store_area', s.area, 'every_days', m.every_days,
    'effective_every_days', app.monitor_effective_days(m), 'next_run_at', m.next_run_at,
    'latest', (select jsonb_build_object('xray_id', l.id, 'status', l.status, 'created_at', l.created_at,
                                         'quorum', (select jsonb_build_object('finished', q.finished, 'total', q.total, 'required', q.required)
                                                      from public.xray_pair_quorum(l.id) q))
                 from public.xray l where l.id = m.last_xray_id),
    'last_ready', (select jsonb_build_object('xray_id', r.id, 'created_at', r.created_at,
                     'on', (r.collected_at at time zone 'America/Sao_Paulo')::date,
                     'rank', k.rank, 'stores_ranked', k.stores_ranked,
                     'previous_rank', (select k2.rank from public.xray r2
                                         join public.xray_store_rank k2 on k2.xray_id = r2.id and k2.is_target
                                        where r2.monitor_id = m.id and r2.status in ('ready', 'delivered') and r2.created_at < r.created_at
                                        order by r2.created_at desc limit 1),
                     'doubts_open', (select count(*) from public.xray_item i where i.xray_id = r.id and i.pair_status = 'revisar'
                                       and i.reviewed_at is null and exists (select 1 from public.xray_pair p where p.xray_item_id = i.id)))
                     from public.xray r left join public.xray_store_rank k on k.xray_id = r.id and k.is_target
                    where r.monitor_id = m.id and r.status in ('ready', 'delivered')
                    order by r.created_at desc limit 1),
    'extraction_on', public.flag_enabled('m1.extracao', m.account_id, m.env))
    order by m.target_kind desc, m.created_at, m.id), '[]')
    from public.xray_monitor m join public.public_store s on s.id = m.target_store_id
   where m.id = any (p_monitors)
$$;

-- P19 plan line and P20 cost line: the account's limits and use (draft §3.3), as the server checks them.
create function public.monitor_limits(p_account uuid, p_env public.flag_env default 'sandbox') returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plan', app.flag_plan_code(p_account),
    'competitor_allowed', public.flag_enabled('m1.concorrente', p_account, p_env),
    'competitor_max', app.monitor_competitor_max(p_account, p_env),
    'competitor_active', u.competitor_active,
    'competitor_started_month', u.competitor_started_month,
    'count_month_starts', app.monitor_param('m1.monitor_count_month_starts', 1) = 1,
    'own_max', app.monitor_own_max(p_account),
    'own_active', u.own_active,
    'min_every_days', app.monitor_min_every_days(p_account),
    'gerente_answers', app.monitor_param('m1.portal_gerente_answers', 1) = 1)
    from app.monitor_usage(p_account) u
$$;

-- Grants: service role only (see 20261031000005_flags.sql) -------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'app.monitor_param(text, numeric)',
    'app.monitor_min_every_days(uuid)',
    'app.monitor_own_max(uuid)',
    'app.monitor_competitor_max(uuid, public.flag_env)',
    'app.monitor_usage(uuid)',
    'app.monitor_effective_days(public.xray_monitor)',
    'app.monitor_manager(uuid, uuid)',
    'app.monitor_answerer(public.xray_monitor, uuid)',
    'app.monitor_audit(uuid, public.actor_kind, uuid, text, text, uuid, jsonb, jsonb, inet, text)',
    'app.monitor_row(uuid)',
    'app.monitor_advance(uuid)',
    'app.monitor_queue_calc(uuid)',
    'app.monitor_after_pair(uuid)',
    'app.monitor_start_run(uuid, uuid, timestamptz, boolean)',
    'app.monitor_apply_plan(uuid)',
    'app.monitor_answer_one(uuid, uuid[], uuid, boolean, inet, text)',
    'app.monitor_suggestion(uuid)',
    'app.monitor_store_label(uuid, uuid)',
    'app.monitor_capture_rows(uuid)',
    'app.monitor_item_group(text, bigint)',
    'app.monitor_group_order(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.xray_pair_decisions(uuid)',
    'public.monitor_queue_due(public.flag_env, timestamptz)',
    'public.monitor_create(uuid, text, text, uuid, int, int, text[], jsonb, uuid, public.flag_env, inet, text)',
    'public.monitor_set_status(uuid, text, uuid, public.flag_env, inet, text)',
    'public.monitor_set_period(uuid, int, uuid, inet, text)',
    'public.monitor_answer(uuid, uuid[], uuid, boolean, inet, text)',
    'public.monitor_answer_many(uuid, jsonb, uuid, inet, text)',
    'public.monitor_confirm_suggestions(uuid, uuid[], uuid, inet, text)',
    'public.monitor_undo(uuid, uuid, inet, text)',
    'public.monitor_progress(uuid)',
    'public.monitor_doubts(uuid)',
    'public.monitor_items(uuid)',
    'public.monitor_result(uuid)',
    'public.monitor_history(uuid)',
    'public.monitor_item_history(uuid, uuid)',
    'public.monitor_item_picker(uuid)',
    'public.monitor_partial(uuid)',
    'public.monitor_summaries(uuid[])',
    'public.monitor_limits(uuid, public.flag_env)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
