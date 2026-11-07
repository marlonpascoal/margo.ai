-- B01 monitorings (docs/m1-owner-journey-draft.md): plan limits, downgrade and upgrade, permissions, audit, the flag,
-- the notices and RLS (A02, A03). The run flow itself is in workers/collector/tests/test_b01_monitor_db.py.
-- All stores, people and accounts here are SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.id(tag text) returns uuid language sql immutable as $$ select md5('mon:' || tag)::uuid $$;
create function tests.ext(n int) returns text language sql immutable as $$ select 'abcdef01-0000-4000-8000-' || lpad(n::text, 12, '0') $$;
create function tests.url(n int) returns text language sql immutable as $$
  select 'https://www.ifood.com.br/delivery/cidade-sintetica-pr/loja/' || tests.ext(n) $$;

create function tests.person(tag text) returns uuid language plpgsql as $$
begin
  insert into auth.users (id, email) values (tests.id(tag || ':auth'), tag || '@teste.local');
  insert into public.person (id, auth_user_id, name) values (tests.id(tag), tests.id(tag || ':auth'), tag);
  return tests.id(tag);
end $$;

create function tests.account(a text, p_plan text) returns void language plpgsql as $$
declare acc uuid := tests.id(a);
begin
  insert into public.account (id, name, code, plan_id, is_synthetic)
    values (acc, 'Conta ' || a, 'M-' || a, (select id from public.plan where code = p_plan), true);
  insert into public.subscription (account_id, plan_id, status)
    values (acc, (select id from public.plan where code = p_plan), case p_plan when 'raio_x' then 'free' else 'active' end::public.subscription_status);
  insert into public.company (id, account_id, cnpj, legal_name) values (tests.id(a || ':co'), acc, lpad(ascii(a)::text, 14, '7'), 'Empresa');
  insert into public.kitchen (id, account_id, company_id, name) values
    (tests.id(a || ':k1'), acc, tests.id(a || ':co'), 'Cozinha 1'),
    (tests.id(a || ':k2'), acc, tests.id(a || ':co'), 'Cozinha 2');
  insert into public.membership (id, account_id, person_id, role, all_kitchens) values
    (tests.id(a || ':m-dono'), acc, tests.person(a || ':dono'), 'dono', true),
    (tests.id(a || ':m-fin'), acc, tests.person(a || ':fin'), 'financeiro', true),
    (tests.id(a || ':m-ger'), acc, tests.person(a || ':ger'), 'gerente', false);
  insert into public.membership_kitchen (membership_id, kitchen_id) values (tests.id(a || ':m-ger'), tests.id(a || ':k1'));
end $$;

create function tests.login(tag text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.id(tag || ':auth'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.n(q text) returns int language plpgsql as $$
declare r int; begin execute 'select count(*) from (' || q || ') q' into r; return r; end $$;
create function tests.create(a text, n int, kitchen text default null, days int default 7) returns uuid language sql as $$
  select (public.monitor_create(tests.id(a), tests.ext(n), tests.url(n),
          case when kitchen is null then null else tests.id(a || ':' || kitchen) end, days, 3, '{}', '{}',
          tests.id(a || ':dono'), 'sandbox') ->> 'monitor_id')::uuid
$$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.account('L', 'lucro');
select tests.account('R', 'raio_x');
-- L owns store 1 (kitchen 1) and store 2 (kitchen 2); R owns 50 and 51.
insert into public.channel_store (account_id, kitchen_id, channel, external_id, name, source) values
  (tests.id('L'), tests.id('L:k1'), 'ifood', tests.ext(1), 'Loja 1', 'public'),
  (tests.id('L'), tests.id('L:k2'), 'ifood', tests.ext(2), 'Loja 2', 'public'),
  (tests.id('R'), tests.id('R:k1'), 'ifood', tests.ext(50), 'Loja 50', 'public'),
  (tests.id('R'), tests.id('R:k1'), 'ifood', tests.ext(51), 'Loja 51', 'public');

-- Reference data ----------------------------------------------------------------------------------------------------------
select results_eq($$ select env::text, default_raio_x, default_lucro, default_rede from public.feature_flag where key = 'm1.portal' order by env $$,
  $$ values ('production', false, false, false), ('sandbox', true, true, true) $$, 'PROVISIONAL Q5: m1.portal on in sandbox, off in production');
select results_eq($$ select code, audience_roles from public.notice_type where code like 'xray_%' order by code $$,
  $$ values ('xray_needs_answer', array['dono', 'gerente']), ('xray_ready', array['dono', 'gerente']) $$,
  'PROVISIONAL Q8: the two new notices go to Dono and Gerente');
select is((select value from public.rule_param where key = 'm1.monitor_rediscover_days'), 28::numeric, 'discovery every 28 days (param)');
select is((select value from public.rule_param where key = 'm1.monitor_min_every_days_raio_x'), 90::numeric, 'PROVISIONAL Q3: free plan every 90 days (param)');

-- Create: own and competitor, permissions ---------------------------------------------------------------------------------
create temp table m_own as select tests.create('L', 1) as id;
select results_eq($$ select target_kind, kitchen_id, status::text, every_days from public.xray_monitor where id = (select id from m_own) $$,
  $$ values ('own', tests.id('L:k1'), 'active', 7) $$, 'B01: an own store takes its kitchen');
select is((select count(*)::int from public.xray where monitor_id = (select id from m_own) and status = 'collecting'), 1,
  'B01: the first run is an ordinary xray with monitor_id');
select is((select count(*)::int from public.job j join public.xray x on x.id = (j.payload ->> 'xray_id')::uuid
            where j.type = 'extract_discover' and x.monitor_id = (select id from m_own)), 1, 'B01: the first run starts with a discovery');
select is((select count(*)::int from public.audit_log where action = 'monitor.create' and entity_id = (select id from m_own)
             and actor_person_id = tests.id('L:dono') and actor_kind = 'person'), 1, 'A04: create is audited');
select throws_ok($$ select tests.create('L', 1) $$, 'P0001', null, 'the same store cannot be monitored twice');
select throws_ok($$ select public.monitor_create(tests.id('L'), tests.ext(9), tests.url(9), null, 7, 3, '{}', '{}', tests.id('L:fin'), 'sandbox') $$,
  '42501', 'monitor_not_allowed', 'draft §2.1: Financeiro cannot start a monitoring');
select throws_ok($$ select public.monitor_create(tests.id('L'), tests.ext(9), tests.url(9), null, 7, 3, '{}', '{}', tests.id('L:ger'), 'sandbox') $$,
  '42501', 'monitor_not_allowed', 'draft §2.1: Gerente cannot start a monitoring');
select throws_ok($$ select public.monitor_create(tests.id('L'), tests.ext(9), tests.url(9), null, 7, 3, '{}', '{}', tests.id('R:dono'), 'sandbox') $$,
  '42501', 'monitor_not_allowed', 'A02: a Dono of another account cannot start one here');
select throws_ok($$ select public.monitor_create(tests.id('L'), tests.ext(9), tests.url(9), tests.id('R:k1'), 7, 3, '{}', '{}', tests.id('L:dono'), 'sandbox') $$,
  'P0001', 'monitor_bad_kitchen', 'a competitor near a kitchen of another account is refused');
select throws_ok($$ select public.monitor_create(tests.id('L'), tests.ext(9), tests.url(9), null, 7, 3, '{}', '{}', tests.id('L:dono'), 'production') $$,
  'P0001', 'monitor_not_enabled', 'flag m1.portal gates monitorings');

-- Competitor limits (Lucro: 3 active, 3 started per month) ------------------------------------------------------------------
create temp table m_comp as select tests.create('L', n, 'k1') as id, n from generate_series(10, 12) n;
select is((select count(*)::int from public.xray_monitor where account_id = tests.id('L') and target_kind = 'competitor'), 3, 'three competitors on Lucro');
select throws_ok($$ select tests.create('L', 13, 'k1') $$, 'P0001', 'monitor_competitor_limit:3', 'B01: the fourth active competitor is refused');
select public.monitor_set_status((select id from m_comp where n = 12), 'remove', tests.id('L:dono'));
select is((select status::text from public.xray_monitor where id = (select id from m_comp where n = 12)), 'removed', 'remove keeps the row');
select is((select count(*)::int from public.xray where monitor_id = (select id from m_comp where n = 12)), 1, 'remove keeps the runs');
select throws_ok($$ select tests.create('L', 13, 'k1') $$, 'P0001', 'monitor_competitor_month_limit:3',
  'PROVISIONAL Q2: removing does not give back a start of this month');
update public.rule_param set value = 0 where key = 'm1.monitor_count_month_starts';
select lives_ok($$ select tests.create('L', 13, 'k1') $$, 'with m1.monitor_count_month_starts = 0 only the active ones count');
update public.rule_param set value = 1 where key = 'm1.monitor_count_month_starts';

-- Pause, resume, period ------------------------------------------------------------------------------------------------------
select public.monitor_set_status((select id from m_comp where n = 10), 'pause', tests.id('L:dono'));
select is((select status::text from public.xray_monitor where id = (select id from m_comp where n = 10)), 'paused_by_person', 'pause by the Dono');
select throws_ok($$ select public.monitor_set_status((select id from m_comp where n = 11), 'pause', tests.id('L:fin')) $$,
  '42501', 'monitor_not_allowed', 'Financeiro cannot pause');
select is((select count(*)::int from public.audit_log where action = 'monitor.pause' and entity_id = (select id from m_comp where n = 10)), 1, 'pause is audited');
select lives_ok($$ select public.monitor_set_status((select id from m_comp where n = 10), 'resume', tests.id('L:dono')) $$, 'resume within the limit');
select throws_ok($$ select public.monitor_set_period((select id from m_own), 3, tests.id('L:dono')) $$, 'P0001', 'monitor_min_every_days:7',
  'the period is at least the plan minimum');
select public.monitor_set_period((select id from m_own), 14, tests.id('L:dono'));
select is((select every_days from public.xray_monitor where id = (select id from m_own)), 14, 'Mudar frequência');

-- Free plan: one own store, every 90 days ------------------------------------------------------------------------------------
select throws_ok($$ select tests.create('R', 50) $$, 'P0001', 'monitor_min_every_days:90', 'PROVISIONAL Q3: free plan waits 90 days');
select lives_ok($$ select tests.create('R', 50, null, 90) $$, 'free plan: one own store');
select throws_ok($$ select tests.create('R', 51, null, 90) $$, 'P0001', 'monitor_own_limit:1', 'free plan: the second own store is refused');
select throws_ok($$ select tests.create('R', 60, null, 90) $$, 'P0001', 'competitor_xray_not_in_plan', 'free plan: no competitor');

-- Downgrade pauses, upgrade resumes ------------------------------------------------------------------------------------------
select tests.create('L', 2);
update public.subscription set plan_id = (select id from public.plan where code = 'raio_x'), status = 'free' where account_id = tests.id('L');
select is((select count(*)::int from public.xray_monitor where account_id = tests.id('L') and target_kind = 'competitor' and status = 'paused_by_plan'), 3,
  'B01: a downgrade pauses every competitor, never deletes');
select results_eq($$ select status::text from public.xray_monitor where account_id = tests.id('L') and target_kind = 'own' order by created_at $$,
  $$ values ('active'), ('paused_by_plan') $$, 'B01: the oldest own store stays, the rest paused by the plan');
select is(app.monitor_effective_days((select m from public.xray_monitor m where id = (select id from m_own))), 90,
  'the kept own store runs every 90 days without rewriting its period');
select throws_ok($$ select public.monitor_set_status((select id from m_comp where n = 10), 'resume', tests.id('L:dono')) $$,
  'P0001', 'monitor_paused_by_plan', 'a monitoring paused by the plan comes back only with the plan');
select is((select count(*)::int from public.audit_log where action = 'monitor.paused_by_plan' and account_id = tests.id('L') and actor_kind = 'system'), 4,
  'pauses by the plan are audited as the system');
update public.subscription set plan_id = (select id from public.plan where code = 'lucro'), status = 'active' where account_id = tests.id('L');
update public.account set plan_id = (select id from public.plan where code = 'raio_x') where id = tests.id('L');
select is((select count(*)::int from public.xray_monitor where account_id = tests.id('L') and status = 'active'), 5,
  'an account plan change runs the same check (the subscription still says Lucro)');
select is((select count(*)::int from public.xray_monitor where account_id = tests.id('L') and status = 'active'), 5, 'B01: an upgrade resumes them');

-- Loaders --------------------------------------------------------------------------------------------------------------------
select is((public.monitor_limits(tests.id('L'), 'sandbox') ->> 'competitor_max')::int, 3, 'P19 plan line: competitor limit');
select is((public.monitor_limits(tests.id('L'), 'sandbox') ->> 'competitor_active')::int, 3, 'P19 plan line: competitors active');
select is(jsonb_array_length(public.monitor_summaries(array(select id from public.xray_monitor where account_id = tests.id('L')))), 6,
  'P19: one summary per monitoring, removed ones included (history)');
select is(public.monitor_progress((select last_xray_id from public.xray_monitor where id = (select id from m_own))) ->> 'step', 'discover',
  'P21: a first run waits for the neighborhood');

-- RLS: A02 and A03 -------------------------------------------------------------------------------------------------------------
select tests.login('L:dono');
select is(tests.n($$ select 1 from public.xray_monitor $$), 6, 'Dono sees every monitoring of the account, removed included');
select is(tests.n($$ select 1 from public.xray_monitor where account_id = tests.id('R') $$), 0, 'A02: no monitoring of another account');
select is(tests.n($$ select 1 from public.xray where account_id = tests.id('R') $$), 0, 'A02: no run of another account');
reset role;
select tests.login('L:ger');
select is(tests.n($$ select 1 from public.xray_monitor $$), 5, 'A03: Gerente of kitchen 1 sees its own store and the competitors near it');
select is(tests.n($$ select 1 from public.xray_monitor where kitchen_id = tests.id('L:k2') $$), 0, 'A03: not the store of kitchen 2');
reset role;

select * from finish();
rollback;
