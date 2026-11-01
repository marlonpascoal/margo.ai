-- B01 competitor X-rays (Marlon, 31/out): plan.competitor_xrays_per_month and flag m1.concorrente, checked
-- by public.xray_create when the X-ray is for an account and its target is not one of the account's stores.
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

-- Plan field and flag.
select col_not_null('public', 'plan', 'competitor_xrays_per_month', 'B01 competitor: plan.competitor_xrays_per_month');
select results_eq($$ select code, competitor_xrays_per_month from public.plan order by price_cents nulls last $$,
  $$ values ('raio_x', 0), ('lucro', 3), ('rede', 10) $$, 'B01 competitor: Raio-X 0, Lucro 3, Rede 10 a month');
select throws_ok($$ update public.plan set competitor_xrays_per_month = -1 where code = 'lucro' $$,
  '23514', null, 'B01 competitor: the monthly limit is not negative');
select results_eq($$ select env::text, default_raio_x, default_lucro, default_rede from public.feature_flag
                     where key = 'm1.concorrente' order by env::text desc $$,
  $$ values ('sandbox', false, true, true), ('production', false, true, true) $$,
  'B01 competitor: flag m1.concorrente, off in Raio-X, on in Lucro and Rede, both environments');

-- Fixtures: a Lucro account with its own iFood store, a Raio-X account, a Rede account.
insert into public.account (id, name, code, plan_id, is_synthetic) values
  ('c0000000-0000-4000-8000-000000000001', 'Lucro teste', 'T-C1', (select id from public.plan where code = 'lucro'), true),
  ('c0000000-0000-4000-8000-000000000002', 'Raio-X teste', 'T-C2', (select id from public.plan where code = 'raio_x'), true),
  ('c0000000-0000-4000-8000-000000000003', 'Rede teste', 'T-C3', (select id from public.plan where code = 'rede'), true);
insert into public.channel_store (account_id, channel, external_id, name, source) values
  ('c0000000-0000-4000-8000-000000000001', 'ifood', 'c0000000-0000-4000-8000-0000000000f0', 'Loja própria teste', 'public');
create temp table actor as select person_id as id from public.staff where role = 'fundador' limit 1;

create function pg_temp.mk(acc text, store_no int) returns uuid language sql as $$
  select public.xray_create(
    format('c0000000-0000-4000-8000-0000000000%s', lpad(store_no::text, 2, '0')),
    format('https://www.ifood.com.br/delivery/x/y/c0000000-0000-4000-8000-0000000000%s', lpad(store_no::text, 2, '0')),
    3, array['Lanches'], '{}', (select id from actor), null, 'pgtap', acc::uuid, 'sandbox')
$$;

-- Lucro: three competitor X-rays this month, the fourth is refused.
select lives_ok($$ select pg_temp.mk('c0000000-0000-4000-8000-000000000001', 1) $$, 'B01 competitor: Lucro, 1st competitor');
select lives_ok($$ select pg_temp.mk('c0000000-0000-4000-8000-000000000001', 2) $$, 'B01 competitor: Lucro, 2nd competitor');
select lives_ok($$ select pg_temp.mk('c0000000-0000-4000-8000-000000000001', 3) $$, 'B01 competitor: Lucro, 3rd competitor');
select results_eq($$ select target_kind, count(*)::int from public.xray
                     where account_id = 'c0000000-0000-4000-8000-000000000001' group by 1 $$,
  $$ values ('competitor', 3) $$, 'B01 competitor: the X-rays belong to the chosen account, as competitors');
select is(app.competitor_xrays_used('c0000000-0000-4000-8000-000000000001'), 3, 'B01 competitor: 3 used this month');
select throws_ok($$ select pg_temp.mk('c0000000-0000-4000-8000-000000000001', 4) $$,
  'P0001', 'competitor_xray_limit:3', 'B01 competitor: Lucro, the 4th in the month is refused');
select lives_ok($$ select public.xray_create('c0000000-0000-4000-8000-0000000000f0',
  'https://www.ifood.com.br/delivery/x/y/c0000000-0000-4000-8000-0000000000f0', 3, array['Lanches'], '{}',
  (select id from actor), null, 'pgtap', 'c0000000-0000-4000-8000-000000000001', 'sandbox') $$,
  'B01 competitor: an X-ray of the account''s own store has no limit');
select is((select count(*)::int from public.xray where account_id = 'c0000000-0000-4000-8000-000000000001' and target_kind = 'own'), 1,
  'B01 competitor: own store recorded as own');
select results_eq($$ select a.after ->> 'target_kind', count(*)::int from public.audit_log a
                     join public.xray x on x.id = a.entity_id
                    where a.action = 'xray.create' and a.account_id = 'c0000000-0000-4000-8000-000000000001'
                    group by 1 order by 1 $$,
  $$ values ('competitor', 3), ('own', 1) $$,
  'A04: the xray.create audit row records the target kind');

-- The month is São Paulo's: an X-ray from before local midnight of day 1 belongs to the previous month.
update public.xray set created_at = (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '1 minute'
 where account_id = 'c0000000-0000-4000-8000-000000000001' and target_kind = 'competitor';
select is(app.competitor_xrays_used('c0000000-0000-4000-8000-000000000001'), 0,
  'B01 competitor: X-rays of the previous São Paulo month do not count');
update public.xray set created_at = (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 minute'
 where account_id = 'c0000000-0000-4000-8000-000000000001' and target_kind = 'competitor';
select is(app.competitor_xrays_used('c0000000-0000-4000-8000-000000000001'), 3,
  'B01 competitor: X-rays after São Paulo midnight of day 1 count');

-- Raio-X grátis: flag off, refused; flag on by exception, still refused by the limit 0.
select throws_ok($$ select pg_temp.mk('c0000000-0000-4000-8000-000000000002', 5) $$,
  'P0001', 'competitor_xray_not_in_plan', 'B01 competitor: Raio-X grátis, refused (flag off)');
insert into public.feature_override (flag_key, env, account_id, value, reason) values
  ('m1.concorrente', 'sandbox', 'c0000000-0000-4000-8000-000000000002', true, 'pgtap');
select throws_ok($$ select pg_temp.mk('c0000000-0000-4000-8000-000000000002', 5) $$,
  'P0001', 'competitor_xray_limit:0', 'B01 competitor: Raio-X grátis with the flag on, refused by the limit 0');
select is((select count(*)::int from public.xray where account_id = 'c0000000-0000-4000-8000-000000000002'), 0,
  'B01 competitor: a refused X-ray writes nothing');

-- Flag off by exception for a Rede account: refused although the limit is 10.
insert into public.feature_override (flag_key, env, account_id, value, reason) values
  ('m1.concorrente', 'sandbox', 'c0000000-0000-4000-8000-000000000003', false, 'pgtap');
select throws_ok($$ select pg_temp.mk('c0000000-0000-4000-8000-000000000003', 6) $$,
  'P0001', 'competitor_xray_not_in_plan', 'B01 competitor: flag off for the account, refused');

-- A lead (no account) has no limit; an unknown account is refused.
select lives_ok($$ select public.xray_create('c0000000-0000-4000-8000-000000000099',
  'https://www.ifood.com.br/delivery/x/y/c0000000-0000-4000-8000-000000000099', 3, array['Lanches'], '{}',
  (select id from actor)) $$, 'B01 competitor: a lead X-ray has no account and no limit');
select throws_ok($$ select pg_temp.mk('c0000000-0000-4000-8000-0000000000ff', 7) $$,
  'P0002', null, 'B01 competitor: an unknown account is refused');

select * from finish();
rollback;
