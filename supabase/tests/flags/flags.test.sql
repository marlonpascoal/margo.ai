-- Feature flags (04 §6, D34, A05): evaluation in public.flag_enabled and the C20 change functions.
begin;
create extension if not exists pgtap with schema extensions;

select plan(47);

-- Fixtures: one account per evaluation branch, a fundador, an operação and a restaurant person.
insert into public.account (id, name, code, plan_id) values
  ('f0000000-0000-0000-0000-000000000001', 'Raio-X ativa', 'T-F1', (select id from public.plan where code = 'raio_x')),
  ('f0000000-0000-0000-0000-000000000002', 'Rede ativa', 'T-F2', (select id from public.plan where code = 'raio_x')),
  ('f0000000-0000-0000-0000-000000000003', 'Rede em teste', 'T-F3', (select id from public.plan where code = 'rede')),
  ('f0000000-0000-0000-0000-000000000004', 'Teste acabou', 'T-F4', (select id from public.plan where code = 'lucro')),
  ('f0000000-0000-0000-0000-000000000005', 'Sem assinatura', 'T-F5', (select id from public.plan where code = 'lucro')),
  ('f0000000-0000-0000-0000-000000000006', 'Sem plano', 'T-F6', null),
  ('f0000000-0000-0000-0000-000000000007', 'Raio-X em teste', 'T-F7', (select id from public.plan where code = 'raio_x'));
insert into public.subscription (account_id, plan_id, status) values
  ('f0000000-0000-0000-0000-000000000001', (select id from public.plan where code = 'raio_x'), 'active'),
  ('f0000000-0000-0000-0000-000000000002', (select id from public.plan where code = 'rede'), 'active'),
  ('f0000000-0000-0000-0000-000000000003', (select id from public.plan where code = 'rede'), 'trial'),
  ('f0000000-0000-0000-0000-000000000004', (select id from public.plan where code = 'raio_x'), 'free'),
  ('f0000000-0000-0000-0000-000000000007', (select id from public.plan where code = 'raio_x'), 'trial');
insert into public.person (id, name, email) values
  ('e0000000-0000-0000-0000-000000000001', 'Fundador', 'fundador-flags@teste.local'),
  ('e0000000-0000-0000-0000-000000000002', 'Operação', 'operacao-flags@teste.local'),
  ('e0000000-0000-0000-0000-000000000003', 'Pessoa', 'pessoa-flags@teste.local');
insert into public.staff (person_id, role) values
  ('e0000000-0000-0000-0000-000000000001', 'fundador'),
  ('e0000000-0000-0000-0000-000000000002', 'operacao');

create function pg_temp.on(k text, acc text, env text default 'sandbox') returns boolean
language sql as $$ select public.flag_enabled(k, acc::uuid, env::public.flag_env) $$;

-- Plan defaults --------------------------------------------------------------------------------------
select is(pg_temp.on('m2.ifood_api', 'f0000000-0000-0000-0000-000000000001'), false,
  'A05_plan_default: Raio-X subscription gets the Raio-X default (off)');
select is(pg_temp.on('m1.raio_x', 'f0000000-0000-0000-0000-000000000001'), true,
  'A05_plan_default: Raio-X subscription gets the Raio-X default (on)');
select is(pg_temp.on('m2.ifood_api', 'f0000000-0000-0000-0000-000000000002'), true,
  'A05_plan_default: the subscription plan wins over account.plan_id');
select is(pg_temp.on('m2.ifood_api', 'f0000000-0000-0000-0000-000000000004'), false,
  'A05_plan_default: trial ended (free, Raio-X) gets the Raio-X defaults');
select is(pg_temp.on('m2.ifood_api', 'f0000000-0000-0000-0000-000000000005'), true,
  'A05_plan_default: no subscription uses account.plan_id');
select is(pg_temp.on('m1.raio_x', 'f0000000-0000-0000-0000-000000000006'), false,
  'A05_plan_default: no subscription and no plan is off');

-- Free trial gets the Lucro defaults ---------------------------------------------------------------
select is(pg_temp.on('m2.ifood_api', 'f0000000-0000-0000-0000-000000000007'), true,
  'A05_trial: a Raio-X trial gets the Lucro default (on)');
select is(pg_temp.on('m3.nfce_qr_auto', 'f0000000-0000-0000-0000-000000000007'), false,
  'A05_trial: a trial gets the Lucro default (off)');
update public.feature_flag set default_rede = true where key = 'l.painel_dono' and env = 'sandbox';
select is(pg_temp.on('l.painel_dono', 'f0000000-0000-0000-0000-000000000003'), false,
  'A05_trial: a Rede trial gets the Lucro defaults, not the Rede ones');
select is(pg_temp.on('l.painel_dono', 'f0000000-0000-0000-0000-000000000002'), true,
  'A05_plan_default: an active Rede account gets the Rede default');

-- Exceptions beat the plan default, per env --------------------------------------------------------
insert into public.feature_override (flag_key, env, account_id, value, reason) values
  ('m2.ifood_api', 'sandbox', 'f0000000-0000-0000-0000-000000000001', true, 'teste'),
  ('m1.raio_x', 'sandbox', 'f0000000-0000-0000-0000-000000000002', false, 'teste'),
  ('m3.nfce_qr_auto', 'sandbox', 'f0000000-0000-0000-0000-000000000007', true, 'teste');
select is(pg_temp.on('m2.ifood_api', 'f0000000-0000-0000-0000-000000000001'), true,
  'A05_exception: an exception turns on what the plan leaves off');
select is(pg_temp.on('m1.raio_x', 'f0000000-0000-0000-0000-000000000002'), false,
  'A05_exception: an exception turns off what the plan turns on');
select is(pg_temp.on('m3.nfce_qr_auto', 'f0000000-0000-0000-0000-000000000007'), true,
  'A05_exception: an exception beats the trial defaults');
select is(pg_temp.on('m2.ifood_api', 'f0000000-0000-0000-0000-000000000001', 'production'), false,
  'A05_env: a sandbox exception does not apply in production');
select is(pg_temp.on('l.painel_dono', 'f0000000-0000-0000-0000-000000000002', 'production'), false,
  'A05_env: a sandbox default does not apply in production');

-- Unknown inputs and the null account ---------------------------------------------------------------
select is(pg_temp.on('m9.nao_existe', 'f0000000-0000-0000-0000-000000000002'), false, 'A05_unknown_key_is_off');
select is(pg_temp.on('m9.nao_existe', null), false, 'A05_unknown_key_is_off without an account');
select is(pg_temp.on('m1.raio_x', 'f0000000-0000-0000-0000-0000000000ff'), false, 'A05_unknown_account_is_off');
select is(pg_temp.on('m2.ifood_api', null), true, 'A05_no_account: a flag on in some plan is on (launched)');
select is(pg_temp.on('m3.nfce_qr_auto', null), false, 'A05_no_account: a flag off in all plans is off (not launched)');

-- Seed (G-SYN): G-03 is on trial with its exception, G-04 is free on Raio-X.
select is(public.flag_enabled('m2.ifood_api', (select id from public.account where code = 'G-04'), 'production'), false,
  'A05_seed: G-04 (free, Raio-X) has no iFood API');
select is(public.flag_enabled('m3.nfce_qr_auto', (select id from public.account where code = 'G-01'), 'production'), true,
  'A05_seed: Pantanos has its QR exception');

-- Security ------------------------------------------------------------------------------------------
select ok((select prosecdef from pg_proc where oid = 'public.flag_enabled(text, uuid, public.flag_env)'::regprocedure),
  'flag_enabled is security definer');
select ok((select 'search_path=""' = any(proconfig) from pg_proc
           where oid = 'public.flag_enabled(text, uuid, public.flag_env)'::regprocedure),
  'flag_enabled sets an empty search_path');
select ok(has_function_privilege('service_role', 'public.flag_enabled(text, uuid, public.flag_env)', 'execute'),
  'service_role may evaluate flags');
select ok(not has_function_privilege('anon', 'public.flag_enabled(text, uuid, public.flag_env)', 'execute'),
  'anon may not evaluate flags');
select ok(not has_function_privilege('authenticated', 'public.flag_enabled(text, uuid, public.flag_env)', 'execute'),
  'authenticated may not evaluate flags');
select is_empty($$
  select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'flag\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
$$, 'no flag function is callable by anon or authenticated');

-- C20: plan defaults ---------------------------------------------------------------------------------
select throws_ok($$
  select public.flag_set_default('m2.ifood_api', 'sandbox', 'raio_x', true, 'e0000000-0000-0000-0000-000000000002')
$$, '42501', null, 'C20_operacao_cannot_change_a_default');
select throws_ok($$
  select public.flag_set_default('m2.ifood_api', 'sandbox', 'raio_x', true, 'e0000000-0000-0000-0000-000000000003')
$$, '42501', null, 'C20_non_staff_cannot_change_a_default');
select throws_ok($$
  select public.flag_set_default('m2.ifood_api', 'sandbox', 'gratis', true, 'e0000000-0000-0000-0000-000000000001')
$$, '22023', null, 'C20_unknown_plan_is_refused');
select throws_ok($$
  select public.flag_set_default('m9.nao_existe', 'sandbox', 'lucro', true, 'e0000000-0000-0000-0000-000000000001')
$$, 'P0002', null, 'C20_unknown_flag_is_refused');
select is((select count(*)::int from public.feature_flag_log where flag_key = 'm2.contestacao' or by::text like 'e0000000-%'), 0,
  'C20: refused changes write no log');

select lives_ok($$
  select public.flag_set_default('m2.contestacao', 'sandbox', 'lucro', false, 'e0000000-0000-0000-0000-000000000001',
                                 '10.0.0.1', 'pgtap')
$$, 'C20_fundador_changes_a_default');
select results_eq($$
  select default_raio_x, default_lucro, default_rede from public.feature_flag where key = 'm2.contestacao' and env = 'sandbox'
$$, $$ values (false, false, true) $$, 'C20: only the chosen plan and env change');
select results_eq($$
  select default_lucro from public.feature_flag where key = 'm2.contestacao' and env = 'production'
$$, $$ values (true) $$, 'C20: production keeps its own default');
select results_eq($$
  select flag_key, env::text, account_id, old, new, by from public.feature_flag_log where by::text like 'e0000000-%'
$$, $$ values ('m2.contestacao', 'sandbox', null::uuid, true, false, 'e0000000-0000-0000-0000-000000000001'::uuid) $$,
  'A05_change_writes_feature_flag_log: plan default (account null)');
select results_eq($$
  select actor_person_id, actor_kind::text, account_id, action, entity, before->>'plan', before->>'value', after->>'value',
         host(ip), user_agent
  from public.audit_log where entity = 'feature_flag' and actor_person_id::text like 'e0000000-%'
$$, $$ values ('e0000000-0000-0000-0000-000000000001'::uuid, 'staff', null::uuid, 'flag_default_set', 'feature_flag',
               'lucro', 'true', 'false', '10.0.0.1', 'pgtap') $$,
  'A04_change_writes_audit_log: plan default');
select lives_ok($$
  select public.flag_set_default('m2.contestacao', 'sandbox', 'lucro', false, 'e0000000-0000-0000-0000-000000000001')
$$, 'C20: setting the same value again');
select is((select count(*)::int from public.feature_flag_log where by::text like 'e0000000-%'), 1, 'C20: a call that changes nothing writes nothing');

-- C20: account exceptions ---------------------------------------------------------------------------
select throws_ok($$
  select public.flag_set_override('m2.contestacao', 'sandbox', 'f0000000-0000-0000-0000-000000000005', true, '  ',
                                  'e0000000-0000-0000-0000-000000000001')
$$, '22023', null, 'C20_exception_needs_a_reason');
select throws_ok($$
  select public.flag_set_override('m2.contestacao', 'sandbox', 'f0000000-0000-0000-0000-000000000005', true, 'piloto',
                                  'e0000000-0000-0000-0000-000000000002')
$$, '42501', null, 'C20_operacao_cannot_add_an_exception');

select public.flag_set_override('m2.contestacao', 'sandbox', 'f0000000-0000-0000-0000-000000000005', true, ' piloto ',
                                'e0000000-0000-0000-0000-000000000001');
select public.flag_set_override('m2.contestacao', 'sandbox', 'f0000000-0000-0000-0000-000000000005', false, 'fim do piloto',
                                'e0000000-0000-0000-0000-000000000001');
select is(pg_temp.on('m2.contestacao', 'f0000000-0000-0000-0000-000000000005'), false,
  'A05_exception: the latest exception value applies');
select throws_ok($$
  select public.flag_remove_override('m2.contestacao', 'sandbox', 'f0000000-0000-0000-0000-000000000005',
                                     'e0000000-0000-0000-0000-000000000002')
$$, '42501', null, 'C20_operacao_cannot_remove_an_exception');
select public.flag_remove_override('m2.contestacao', 'sandbox', 'f0000000-0000-0000-0000-000000000005',
                                   'e0000000-0000-0000-0000-000000000001');
select public.flag_remove_override('m2.contestacao', 'sandbox', 'f0000000-0000-0000-0000-000000000005',
                                   'e0000000-0000-0000-0000-000000000001');
select is(pg_temp.on('m2.contestacao', 'f0000000-0000-0000-0000-000000000005'), false,
  'A05_exception: removed, the account falls back to the (now off) Lucro default');

select bag_eq($$
  select old, new from public.feature_flag_log where account_id = 'f0000000-0000-0000-0000-000000000005'
$$, $$ values (null::boolean, true), (true, false), (false, null::boolean) $$,
  'A05_change_writes_feature_flag_log: add, change, remove (removing nothing writes nothing)');
select bag_eq($$
  select action, before->>'reason' as before_reason, after->>'reason' as after_reason from public.audit_log
  where account_id = 'f0000000-0000-0000-0000-000000000005'
$$, $$ values ('flag_exception_set', null, 'piloto'), ('flag_exception_set', 'piloto', 'fim do piloto'),
              ('flag_exception_removed', 'fim do piloto', null) $$,
  'A04_change_writes_audit_log: exceptions with their reasons, trimmed');

select * from finish();
rollback;
