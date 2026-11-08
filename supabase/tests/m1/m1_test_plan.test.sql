-- B01 "Vou testar" (20261231000008): up to m1.test_max_items items per monitoring, who may mark (as answering doubts),
-- audit, RLS isolation between accounts and the P23 "Seus testes" loader. All stores, people and prices are SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.id(tag text) returns uuid language sql immutable as $$ select md5('test-plan:' || tag)::uuid $$;

create function tests.person(tag text) returns uuid language plpgsql as $$
begin
  insert into auth.users (id, email) values (tests.id(tag || ':auth'), tag || '@teste.local');
  insert into public.person (id, auth_user_id, name) values (tests.id(tag), tests.id(tag || ':auth'), 'Pessoa ' || tag);
  return tests.id(tag);
end $$;

create function tests.account(a text) returns void language plpgsql as $$
declare acc uuid := tests.id(a);
begin
  insert into public.account (id, name, code, plan_id, is_synthetic)
    values (acc, 'Conta ' || a, 'TP-' || a, (select id from public.plan where code = 'lucro'), true);
  insert into public.company (id, account_id, cnpj, legal_name) values (tests.id(a || ':co'), acc, lpad(ascii(a)::text, 14, '8'), 'Empresa');
  insert into public.kitchen (id, account_id, company_id, name) values
    (tests.id(a || ':k1'), acc, tests.id(a || ':co'), 'Cozinha 1'),
    (tests.id(a || ':k2'), acc, tests.id(a || ':co'), 'Cozinha 2');
  insert into public.membership (id, account_id, person_id, role, all_kitchens) values
    (tests.id(a || ':m-dono'), acc, tests.person(a || ':dono'), 'dono', true),
    (tests.id(a || ':m-fin'), acc, tests.person(a || ':fin'), 'financeiro', true),
    (tests.id(a || ':m-ger1'), acc, tests.person(a || ':ger1'), 'gerente', false),
    (tests.id(a || ':m-ger2'), acc, tests.person(a || ':ger2'), 'gerente', false);
  insert into public.membership_kitchen (membership_id, kitchen_id) values
    (tests.id(a || ':m-ger1'), tests.id(a || ':k1')), (tests.id(a || ':m-ger2'), tests.id(a || ':k2'));
end $$;

create function tests.login(tag text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.id(tag || ':auth'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.n(q text) returns int language plpgsql as $$
declare r int; begin execute 'select count(*) from (' || q || ') q' into r; return r; end $$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.account('L');
select tests.account('R');

insert into public.public_store (id, channel, external_id, name)
select tests.id(s), 'ifood', 'tp-' || s, 'Loja Sintética ' || s from unnest(array['T', 'C', 'RT']) s;
-- Own store T (kitchen 1) of L with two runs; a competitor C of L; R's own store RT.
insert into public.xray_monitor (id, account_id, target_store_id, target_kind, kitchen_id, every_days) values
  (tests.id('mo'), tests.id('L'), tests.id('T'), 'own', tests.id('L:k1'), 7),
  (tests.id('mc'), tests.id('L'), tests.id('C'), 'competitor', tests.id('L:k1'), 7),
  (tests.id('mr'), tests.id('R'), tests.id('RT'), 'own', tests.id('R:k1'), 7);
insert into public.xray (id, account_id, target_store_id, target_kind, status, collected_at, created_at, monitor_id) values
  (tests.id('x1'), tests.id('L'), tests.id('T'), 'own', 'ready', '2026-11-02 10:00-03', '2026-11-02 10:00-03', tests.id('mo')),
  (tests.id('x2'), tests.id('L'), tests.id('T'), 'own', 'ready', '2026-11-09 10:00-03', '2026-11-09 10:00-03', tests.id('mo')),
  (tests.id('xc'), tests.id('L'), tests.id('C'), 'competitor', 'ready', '2026-11-02 10:00-03', '2026-11-02 10:00-03', tests.id('mc')),
  (tests.id('xr'), tests.id('R'), tests.id('RT'), 'own', 'ready', '2026-11-02 10:00-03', '2026-11-02 10:00-03', tests.id('mr'));

-- Five own items of T; item e is only in the first run.
insert into public.public_menu_item (id, public_store_id, external_item_id, name, price_cents)
select tests.id('T' || t), tests.id('T'), t, 'Item Sintético ' || upper(t), 2000 from unnest(array['a', 'b', 'c', 'd', 'e']) t;
insert into public.public_menu_item (id, public_store_id, external_item_id, name, price_cents) values
  (tests.id('Ca'), tests.id('C'), 'a', 'Item Sintético C', 2000),
  (tests.id('RTa'), tests.id('RT'), 'a', 'Item Sintético R', 2000);
insert into public.xray_item (id, xray_id, public_menu_item_id, norm_unit, norm_price_cents, parity_cents, gap_pct, reading,
                              pair_status, item_category, skipped)
select tests.id(x || t), tests.id(x), tests.id('T' || t), 'un', 2000, 2500, -0.2, 'pode_subir', 'auto', 'lanches', false
  from unnest(array['x1', 'x2']) x, unnest(array['a', 'b', 'c', 'd', 'e']) t where not (x = 'x2' and t = 'e');
insert into public.xray_item (id, xray_id, public_menu_item_id, norm_unit, norm_price_cents, pair_status, item_category, skipped) values
  (tests.id('xcCa'), tests.id('xc'), tests.id('Ca'), 'un', 2000, 'auto', 'lanches', false),
  (tests.id('xrRa'), tests.id('xr'), tests.id('RTa'), 'un', 2000, 'auto', 'lanches', false);
-- Item a: R$ 20,00 against a middle of R$ 25,00 on x1 (5th of 9); raised to R$ 24,00 on x2, middle R$ 24,50, na_media, 3rd of 9.
insert into public.public_menu_item_snapshot (xray_id, public_store_id, public_menu_item_id, name, price_cents, unit, collected_at) values
  (tests.id('x1'), tests.id('T'), tests.id('Ta'), 'Item Sintético A', 2000, 'un', '2026-11-02 10:00-03'),
  (tests.id('x2'), tests.id('T'), tests.id('Ta'), 'Item Sintético A', 2400, 'un', '2026-11-09 10:00-03');
update public.xray_item set parity_cents = 2450, gap_pct = -0.02, reading = 'na_media' where id = tests.id('x2a');
insert into public.xray_item_position (xray_id, xray_item_id, public_menu_item_id, item_category, percentile, rank, stores) values
  (tests.id('x1'), tests.id('x1a'), tests.id('Ta'), 'lanches', 50, 5, 9),
  (tests.id('x2'), tests.id('x2a'), tests.id('Ta'), 'lanches', 25, 3, 9);

create function tests.mark(item text, actor text, run text default 'x1', mon text default 'mo') returns uuid language sql as $$
  select public.monitor_test_mark(tests.id(mon), tests.id(item), tests.id(run), tests.id(actor))
$$;

-- Param ---------------------------------------------------------------------------------------------------------------
select is((select value from public.rule_param where key = 'm1.test_max_items'), 3::numeric, 'B01_test_plan: m1.test_max_items is 3');

-- Mark, audit ----------------------------------------------------------------------------------------------------------
create temp table t_a as select tests.mark('Ta', 'L:dono') as id;
select is((select count(*)::int from public.monitor_test_item where monitor_id = tests.id('mo') and removed_at is null), 1,
  'B01_test_plan: the Dono marks an item');
select results_eq($$ select from_xray_id, marked_by, public_menu_item_id from public.monitor_test_item where id = (select id from t_a) $$,
  $$ values (tests.id('x1'), tests.id('L:dono'), tests.id('Ta')) $$, 'B01_test_plan: the row keeps the run, the person and the own item');
select is((select count(*)::int from public.audit_log where action = 'monitor.test_mark' and entity = 'monitor_test_item'
             and entity_id = (select id from t_a) and actor_person_id = tests.id('L:dono') and actor_kind = 'person'
             and account_id = tests.id('L')), 1, 'B01_test_plan: A04 marking is audited');
select is(tests.mark('Ta', 'L:dono'), (select id from t_a), 'B01_test_plan: marking again returns the same row');
select is((select count(*)::int from public.audit_log where action = 'monitor.test_mark' and entity_id = (select id from t_a)), 1,
  'B01_test_plan: marking again writes nothing');

-- Permissions (as monitor_answer) ---------------------------------------------------------------------------------------
select lives_ok($$ select tests.mark('Tb', 'L:ger1') $$, 'B01_test_plan: the Gerente of the monitoring''s kitchen marks');
select throws_ok($$ select tests.mark('Tc', 'L:ger2') $$, '42501', 'monitor_not_allowed', 'B01_test_plan: a Gerente of another kitchen cannot');
select throws_ok($$ select tests.mark('Tc', 'L:fin') $$, '42501', 'monitor_not_allowed', 'B01_test_plan: Financeiro only sees');
select throws_ok($$ select tests.mark('Tc', 'R:dono') $$, '42501', 'monitor_not_allowed', 'B01_test_plan: A02 a Dono of another account cannot');
update public.rule_param set value = 0 where key = 'm1.portal_gerente_answers';
select throws_ok($$ select tests.mark('Tc', 'L:ger1') $$, '42501', 'monitor_not_allowed', 'B01_test_plan: m1.portal_gerente_answers 0 leaves it to the Dono');
update public.rule_param set value = 1 where key = 'm1.portal_gerente_answers';
select throws_ok($$ select public.monitor_test_unmark(tests.id('mo'), tests.id('Ta'), tests.id('L:fin')) $$, '42501', 'monitor_not_allowed',
  'B01_test_plan: Financeiro cannot unmark');

-- Bad input --------------------------------------------------------------------------------------------------------------
select throws_ok($$ select tests.mark('Ta', 'L:dono', 'xr') $$, 'P0001', 'monitor_test_bad_item', 'B01_test_plan: a run of another monitoring is refused');
select throws_ok($$ select tests.mark('Te', 'L:dono', 'x2') $$, 'P0001', 'monitor_test_bad_item', 'B01_test_plan: an item not in the run is refused');
select throws_ok($$ select tests.mark('Ca', 'L:dono', 'xc', 'mc') $$, 'P0001', 'monitor_test_own_only', 'B01_test_plan: a competitor monitoring is refused');

-- Limit 3 ----------------------------------------------------------------------------------------------------------------
select tests.mark('Tc', 'L:dono', 'x2');
select throws_ok($$ select tests.mark('Td', 'L:dono', 'x2') $$, 'P0001', 'monitor_test_limit:3', 'B01_test_plan: the fourth item is refused');
select is(public.monitor_test_unmark(tests.id('mo'), tests.id('Tb'), tests.id('L:ger1')),
  (select id from public.monitor_test_item where monitor_id = tests.id('mo') and public_menu_item_id = tests.id('Tb')),
  'B01_test_plan: the Gerente of the kitchen unmarks');
select ok((select removed_at is not null and removed_by = tests.id('L:ger1') from public.monitor_test_item
            where monitor_id = tests.id('mo') and public_menu_item_id = tests.id('Tb')), 'B01_test_plan: unmarking keeps the row');
select is((select count(*)::int from public.audit_log where action = 'monitor.test_unmark' and actor_person_id = tests.id('L:ger1')
             and (after ->> 'removed')::boolean), 1, 'B01_test_plan: A04 unmarking is audited');
select is(public.monitor_test_unmark(tests.id('mo'), tests.id('Tb'), tests.id('L:dono')), null, 'B01_test_plan: unmarking twice writes nothing');
select lives_ok($$ select tests.mark('Td', 'L:dono', 'x2') $$, 'B01_test_plan: after unmarking, a third item fits again');
select public.monitor_test_unmark(tests.id('mo'), tests.id('Td'), tests.id('L:dono'));
select lives_ok($$ select tests.mark('Tb', 'L:dono', 'x2') $$, 'B01_test_plan: an item unmarked may be marked again (a new row)');
select is((select count(*)::int from public.monitor_test_item where monitor_id = tests.id('mo') and public_menu_item_id = tests.id('Tb')), 2,
  'B01_test_plan: history keeps the unmarked row');
-- Active now: a (marked on x1), c and b (marked on x2).

-- Loader ---------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k) from jsonb_object_keys(public.monitor_test_plan(tests.id('x2'))) k),
  array['active', 'items', 'max_items', 'monitor_id', 'own_item_ids', 'target_kind', 'xray_id'], 'B01_test_plan: loader keys');
select is((public.monitor_test_plan(tests.id('x2')) ->> 'active')::int, 3, 'B01_test_plan: loader counts the active tests');
select is(public.monitor_test_plan(tests.id('x2')) -> 'own_item_ids' ->> tests.id('x2a')::text, tests.id('Ta')::text,
  'B01_test_plan: loader maps the run''s items to own items');
select is(public.monitor_test_plan(tests.id('x2')) -> 'items' -> 0,
  jsonb_build_object('test_id', (select id from t_a), 'own_item_id', tests.id('Ta'), 'name', 'Item Sintético A',
    'marked_at', (select marked_at from t_a join public.monitor_test_item t using (id)),
    'marked_on', ((select marked_at from t_a join public.monitor_test_item t using (id)) at time zone 'America/Sao_Paulo')::date,
    'marked_by', 'Pessoa L:dono', 'from_xray_id', tests.id('x1'), 'same_run', false,
    'then', jsonb_build_object('xray_id', tests.id('x1'), 'on', '2026-11-02', 'item_id', tests.id('x1a'), 'own_cents', 2000,
                               'parity_cents', 2500, 'gap_pct', -0.2, 'reading', 'pode_subir', 'rank', 5, 'stores', 9),
    'now', jsonb_build_object('xray_id', tests.id('x2'), 'on', '2026-11-09', 'item_id', tests.id('x2a'), 'own_cents', 2400,
                              'parity_cents', 2450, 'gap_pct', -0.02, 'reading', 'na_media', 'rank', 3, 'stores', 9)),
  'B01_test_plan: a test with the run it was marked on and this run (own price, middle, reading, position)');
select is(public.monitor_test_plan(tests.id('x2')) #>> '{items,1,same_run}', 'true', 'B01_test_plan: a test marked on this run says so');

-- RLS ------------------------------------------------------------------------------------------------------------------
select public.monitor_test_mark(tests.id('mr'), tests.id('RTa'), tests.id('xr'), tests.id('R:dono'));
select tests.login('L:fin');
select is(tests.n($$ select 1 from public.monitor_test_item $$), 5, 'B01_test_plan: Financeiro of L reads L''s tests, unmarked rows included');
reset role;
select tests.login('R:dono');
select is(tests.n($$ select 1 from public.monitor_test_item where account_id = tests.id('L') $$), 0, 'B01_test_plan: A02 no test of another account');
select throws_ok($$ insert into public.monitor_test_item (monitor_id, account_id, public_menu_item_id, from_xray_id)
                   values (tests.id('mr'), tests.id('R'), tests.id('RTa'), tests.id('xr')) $$, '42501', null,
  'B01_test_plan: no direct write, only the audited functions');
reset role;

select * from finish();
rollback;
