-- B01 P23 "Oportunidades" (20261231000007): the flag, the table (one row per run, never updated, staff read only), the
-- queueing after a finished calculation and the loader. G-SYN delivered own run of G-01; all data SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

create temp table the_run on commit drop as
  select x.id from public.xray x join public.account a on a.id = x.account_id
   where a.code = 'G-01' and x.target_kind = 'own' and x.status in ('ready', 'delivered')
     and exists (select 1 from public.xray_item i where i.xray_id = x.id)
   order by x.created_at limit 1;
create function pg_temp.run() returns uuid language sql stable as $$ select id from the_run $$;
create function pg_temp.items(n int) returns text[] language sql stable as $$
  select array(select i.id::text from public.xray_item i join public.xray_item_view v on v.id = i.id
                where i.xray_id = pg_temp.run() order by v.name collate "C" limit n)
$$;
create function pg_temp.queued() returns int language sql stable as $$
  select count(*)::int from public.job where type = 'xray_opportunities' and status = 'queued'
     and payload ->> 'xray_id' = pg_temp.run()::text and dedupe_key = 'xray_opportunities:' || pg_temp.run()::text
$$;
create function pg_temp.calc_done() returns void language sql as $$
  insert into public.job (type, payload, account_id, status)
  select 'xray_calc', jsonb_build_object('xray_id', x.id), x.account_id, 'running' from public.xray x where x.id = pg_temp.run();
  update public.job set status = 'done' where type = 'xray_calc' and status = 'running' and payload ->> 'xray_id' = pg_temp.run()::text;
$$;

-- Flag ------------------------------------------------------------------------------------------------------------------
select results_eq($$ select env::text, default_raio_x, default_lucro, default_rede from public.feature_flag
                     where key = 'm1.oportunidades_ia' order by env::text desc $$,
  $$ values ('sandbox', true, true, true), ('production', false, false, false) $$,
  'm1.oportunidades_ia: sandbox on for every plan, production off for every plan');
select is((select description from public.feature_flag where key = 'm1.oportunidades_ia' and env = 'sandbox'),
  'Oportunidades sugeridas por IA no resultado do raio-X', 'flag description for C20');

-- Table -----------------------------------------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.xray_opportunity'::regclass), 'RLS on');
select policies_are('public', 'xray_opportunity', array['read'], 'staff read only; the portal reads through the loader');
select ok(not has_function_privilege('authenticated', 'public.monitor_opportunities(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.monitor_opportunities(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.monitor_opportunities(uuid)', 'execute'),
  'monitor_opportunities: service role only');

-- Queueing --------------------------------------------------------------------------------------------------------------
select pg_temp.calc_done();
select is(pg_temp.queued(), 1, 'B01: a finished calculation of an own run queues its opportunities (flag on in sandbox)');
select pg_temp.calc_done();
select is(pg_temp.queued(), 1, 'one active job per run (dedupe key)');
delete from public.job where type = 'xray_opportunities' and payload ->> 'xray_id' = pg_temp.run()::text;

insert into public.feature_override (flag_key, env, account_id, value, reason)
select 'm1.oportunidades_ia', 'sandbox', x.account_id, false, 'teste' from public.xray x where x.id = pg_temp.run();
select pg_temp.calc_done();
select is(pg_temp.queued(), 0, 'flag off for the account: nothing queued');
delete from public.feature_override where flag_key = 'm1.oportunidades_ia';

alter table public.xray disable trigger xray_target_kind;
update public.xray set target_kind = 'competitor' where id = pg_temp.run();
select pg_temp.calc_done();
select is(pg_temp.queued(), 0, 'a competitor run: nothing queued');
update public.xray set target_kind = 'own' where id = pg_temp.run();
alter table public.xray enable trigger xray_target_kind;

-- Loader ----------------------------------------------------------------------------------------------------------------
select is(public.monitor_opportunities(pg_temp.run()), null, 'no row: null');

insert into public.xray_opportunity (xray_id, items, facts_hash, model, prompt_version, dropped)
select pg_temp.run(), jsonb_build_array(
         jsonb_build_object('title', 'Primeira', 'why', 'Por quê.', 'item_ids', to_jsonb(pg_temp.items(2)), 'lever', 'subir_preco'),
         jsonb_build_object('title', 'Segunda', 'why', 'Por quê.', 'item_ids', '[]'::jsonb, 'lever', 'acompanhar')),
       'h', 'modelo-de-teste', 'oportunidades.v1', 1;

select results_eq($$ select (o ->> 'dropped')::int, o ->> 'model', o ->> 'prompt_version', jsonb_array_length(o -> 'items')
                      from public.monitor_opportunities(pg_temp.run()) o $$,
  $$ values (1, 'modelo-de-teste', 'oportunidades.v1', 2) $$, 'loader: the row and its opportunities');
select results_eq($$ select (e ->> 'rank')::int, e ->> 'title', e ->> 'lever', jsonb_array_length(e -> 'items')
                      from jsonb_array_elements(public.monitor_opportunities(pg_temp.run()) -> 'items') e $$,
  $$ values (1, 'Primeira', 'subir_preco', 2), (2, 'Segunda', 'acompanhar', 0) $$, 'loader: priority order with ranks');
select results_eq($$ select e ->> 'item_id', e ->> 'name'
                      from jsonb_array_elements(public.monitor_opportunities(pg_temp.run()) -> 'items' -> 0 -> 'items') e $$,
  $$ select v.id::text, v.name from public.xray_item_view v where v.id::text = any (pg_temp.items(2)) order by v.name collate "C" $$,
  'loader: item names in the order cited');

select throws_ok($$ update public.xray_opportunity set dropped = 0 where xray_id = pg_temp.run() $$,
  '23001', null, 'never updated');

select * from finish();
rollback;
