-- Schema conventions (03-data-model), reference data and constraints that RLS relies on.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- 03 §1 and §5 tables exist.
select tables_are('public', array[
  'account', 'company', 'kitchen', 'brand', 'channel_store', 'channel_store_url_history',
  'person', 'membership', 'membership_kitchen', 'invite', 'staff', 'session_device',
  'security_lock', 'owner_authorization',
  'plan', 'subscription', 'billing_event', 'billing_invoice', 'pilot', 'pilot_charge', 'bpo_partner', 'bpo_client',
  'feature_flag', 'feature_override', 'feature_flag_log', 'notice_type', 'notice_pref',
  'notification', 'alert', 'audit_log', 'job', 'extension_token',
  'auth_code_guard',
  'menu_item', 'public_store', 'public_menu_item', 'collector_page_cache', 'xray', 'xray_store', 'xray_item',
  'xray_pair', 'time_log', 'public_store_snapshot', 'public_menu_item_snapshot', 'xray_store_rank',
  'extract_run', 'extract_content', 'extract_copy', 'public_store_private',
  'rule_param', 'import_source', 'import_run', 'column_mapping', 'order_fact', 'order_item_fact', 'ledger_entry',
  'contract_terms', 'campaign', 'close_period', 'close_line', 'difference', 'difference_order', 'contestation',
  'invoice', 'invoice_line', 'ingredient', 'ingredient_match', 'ingredient_price', 'recipe', 'recipe_line',
  'packaging_cost', 'contribution', 'campaign_item', 'close_cost_line', 'close_decision', 'invoice_import', 'ingredient_rule',
  'ingredient_account_rule', 'xray_monitor', 'monitor_pair_decision', 'xray_category_rank', 'xray_item_position', 'xray_menu_score',
  'xray_print', 'xray_print_token', 'm1_attr_learning', 'm1_attr_learning_run', 'monitor_test_item', 'xray_opportunity'
], 'A02: tables of 03 §1 to §5, the login code guard (04 §8), the M1 page cache (D47) and M2 params and evidence');

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
$$, 'A02: RLS is enabled on every public table');

select is_empty($$
  select t.table_name::text from information_schema.tables t
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    and (not exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                     and c.table_name = t.table_name and c.column_name = 'created_at')
      or not exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                     and c.table_name = t.table_name and c.column_name = 'updated_at'))
$$, 'every table has created_at and updated_at');

select is_empty($$
  select table_name || '.' || column_name from information_schema.columns
  where table_schema = 'public' and column_name like '%\_cents' and data_type <> 'bigint'
    and (table_name, column_name) not in (('ingredient_price', 'price_per_base_unit_cents'),
      ('recipe_line', 'price_per_base_unit_cents'), ('recipe_line', 'cost_cents'))
$$, 'money columns (_cents) are bigint centavos; only the per-base-unit price and the unrounded CST-03 line cost are fractional (03 §4)');

select is_empty($$
  select table_name::text from information_schema.columns
  where table_schema = 'public' and column_name = 'account_id' and is_nullable = 'YES'
    and table_name not in ('notification', 'alert', 'audit_log', 'job', 'feature_flag_log', 'billing_event',
                           'xray', 'time_log')
$$, 'tenant tables have account_id not null; only 03 §5 system tables and 03 §2 xray, time_log (leads) allow null');

select is_empty($$
  select tablename::text from pg_policies
  where schemaname = 'public' and tablename in ('extract_run', 'extract_content', 'extract_copy', 'public_store_private')
$$, 'D47c: the extraction tables and the street address have no policy; only the service role reaches them');
select is_empty($$
  select table_name || '.' || column_name from information_schema.columns
  where table_schema = 'public' and column_name ilike '%address%'
    and table_name not in ('kitchen', 'public_store_private')
    and table_name not like 'order%'
$$, 'D47c: a public store''s street address sits in public_store_private and no other catalog table');

-- Reference data (04 §6, §9; D40 placeholders).
select results_eq($$ select code from public.plan order by code $$,
  array['lucro', 'raio_x', 'rede'], 'three plans');
select results_eq($$ select trial_days from public.plan where code = 'lucro' $$,
  array[14], 'trial placeholder of 14 days (D40)');
select is((select count(*)::int from public.feature_flag), 48, '24 flags in sandbox and production (m3.custo: 20261211000001, m1.concorrente: 20261212000001, m1.extracao: 20261220000001, m1.portal: 20261230000001, portal.inicio, portal.lojas, conta.plano: 20261231000005, m1.oportunidades_ia: 20261231000007)');
select results_eq($$
  select default_raio_x, default_lucro, default_rede from public.feature_flag
  where key = 'm2.ifood_api' and env = 'sandbox'
$$, $$ values (false, true, true) $$, 'flag defaults per plan follow 04 §6 (sandbox; production is off at the X-ray-only launch)');
select is((select count(*)::int from public.notice_type), 12, 'ten notices of 04 §9 plus xray_ready and xray_needs_answer (20261230000001, provisional)');
select results_eq($$ select code from public.notice_type where email_locked order by code $$,
  array['billing_result', 'security_event', 'trial_ending'], 'billing and security notices are e-mail locked');

-- Fixture for constraint tests.
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'dono1@teste.local'),
  ('11111111-0000-0000-0000-000000000002', 'dono2@teste.local');
insert into public.account (id, name, code) values ('a0000000-0000-0000-0000-000000000001', 'Conta Teste', 'T-01');
insert into public.person (id, auth_user_id, name, email) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Dono 1', 'dono1@teste.local'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'Dono 2', 'dono2@teste.local');
insert into public.membership (id, account_id, person_id, role) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'dono');
set constraints all immediate;
set constraints all deferred;

-- E04: at least one Dono per account.
savepoint s1;
select throws_ok($$
  update public.membership set role = 'financeiro' where id = 'c0000000-0000-0000-0000-000000000001';
  set constraints all immediate
$$, '23514', null, 'E04: demoting the last Dono is refused');
rollback to savepoint s1;

select throws_ok($$
  delete from public.membership where id = 'c0000000-0000-0000-0000-000000000001';
  set constraints all immediate
$$, '23514', null, 'E04: removing the last Dono is refused');
rollback to savepoint s1;

select throws_ok($$
  insert into public.membership (account_id, person_id, role) values
    ((select id from public.account where code = 'T-01'), 'b0000000-0000-0000-0000-000000000002', 'gerente');
  delete from public.membership where id = 'c0000000-0000-0000-0000-000000000001';
  set constraints all immediate
$$, '23514', null, 'E04: a Gerente alone does not keep the account');
rollback to savepoint s1;

select lives_ok($$
  insert into public.membership (account_id, person_id, role) values
    ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'dono');
  update public.membership set role = 'financeiro' where id = 'c0000000-0000-0000-0000-000000000001';
  set constraints all immediate
$$, 'E04: a Dono can be demoted when another Dono remains');
rollback to savepoint s1;

select lives_ok($$
  delete from public.account where id = 'a0000000-0000-0000-0000-000000000001';
  set constraints all immediate
$$, 'deleting the whole account (deletion job) cascades past the Dono rule');
rollback to savepoint s1;

-- Audit log is append-only (A04).
insert into public.audit_log (actor_kind, action, entity) values ('system', 'test', 'account');
select throws_ok($$ update public.audit_log set action = 'changed' $$, '42501', null,
  'A04: audit_log rows cannot be updated');
select throws_ok($$ delete from public.audit_log $$, '42501', null,
  'A04: audit_log rows cannot be deleted outside the deletion job');
select lives_ok($$
  set local app.deletion_job = 'on';
  delete from public.audit_log where action = 'test';
  reset app.deletion_job
$$, 'the deletion job may delete audit rows of a leaving account');

-- W08: locked notices cannot be turned off by e-mail, through any path.
select throws_ok($$
  insert into public.notice_pref (person_id, account_id, notice_code, email, whatsapp) values
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'billing_result', false, false)
$$, '23514', null, 'E05: billing_result e-mail cannot be turned off');

-- updated_at moves on update.
update public.account set updated_at = '2000-01-01' where code = 'T-01';
update public.account set name = 'Conta Teste 2' where code = 'T-01';
select ok((select updated_at > '2000-01-02' from public.account where code = 'T-01'),
  'updated_at is set by trigger');

-- D29: one row per channel store across accounts.
insert into public.channel_store (account_id, channel, external_id, name, source)
  values ('a0000000-0000-0000-0000-000000000001', 'ifood', 'abc', 'Loja', 'public');
select throws_ok($$
  insert into public.channel_store (account_id, channel, external_id, name, source)
  values ('a0000000-0000-0000-0000-000000000001', 'ifood', 'abc', 'Loja 2', 'api')
$$, '23505', null, 'channel_store is unique by (channel, external_id)');

-- E03: login code guard and sessions (04 §8).
select is_empty($$ select 1 from pg_policies where tablename = 'auth_code_guard' $$,
  'E03: code guard has no policy; only server code with the service role reads it');
select col_is_unique('public', 'session_device', 'auth_session_id', 'E03: one device row per Supabase session');
select col_type_is('public', 'session_device', 'surface', 'session_surface', 'E03: session surface sets its length');

select * from finish();
rollback;
