-- M1 schema (03 §2): read-only RLS for staff, audited write functions (A04, 04 §5), service role only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- RLS: SELECT policies only, staff only.
select is_empty($$
  select tablename || ' ' || cmd from pg_policies
  where schemaname = 'public' and tablename in ('menu_item', 'public_store', 'public_menu_item', 'xray', 'xray_store',
                                                'xray_item', 'xray_pair', 'time_log') and cmd <> 'SELECT'
$$, 'A02: M1 tables have SELECT policies only; writes go through audited functions');
select is_empty($$ select 1 from pg_policies where tablename = 'collector_page_cache' $$,
  'D47: the raw page cache has no policy; only the collector (service role) reads it');
select ok((select not public from storage.buckets where id = 'pdf'), 'P01 PDFs live in a private bucket');

-- Functions are not callable by browser roles.
select ok(not has_function_privilege('authenticated', 'public.xray_create(text, text, int, text[], jsonb, uuid, inet, text, uuid, public.flag_env)', 'execute'),
  'xray_create: not for authenticated');
select ok(not has_function_privilege('anon', 'public.xray_store_set_included(uuid, boolean, uuid, inet, text)', 'execute'),
  'xray_store_set_included: not for anon');
select ok(has_function_privilege('service_role', 'public.xray_mark_delivered(uuid, text, uuid, inet, text)', 'execute'),
  'xray_mark_delivered: service role');

-- Reading as staff and as a portal person.
create function pg_temp.login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select auth_user_id from public.person where id = p), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
insert into auth.users (id, email) values ('22222222-0000-0000-0000-000000000001', 'marlon@margoai.com'),
                                          ('22222222-0000-0000-0000-000000000002', 'pantanos@exemplo.com.br');
update public.person set auth_user_id = '22222222-0000-0000-0000-000000000001' where email = 'marlon@margoai.com';
update public.person set auth_user_id = '22222222-0000-0000-0000-000000000002' where email = 'pantanos@exemplo.com.br';
create temp table ids as select
  (select id from public.person where email = 'marlon@margoai.com') as marlon,
  (select id from public.person where email = 'pantanos@exemplo.com.br') as dono,
  '9aae2f75-4168-fde3-4570-d7bd0f4669d0'::uuid as xray;
grant select on ids to authenticated;

select pg_temp.login((select marlon from ids));
select is((select count(*)::int from public.xray_item), 24, 'staff reads the X-ray items');
reset role;
select pg_temp.login((select dono from ids));
select is((select count(*)::int from public.xray), 0, 'the owner portal does not read X-rays yet (wave 2)');
select is((select count(*)::int from public.public_menu_item), 0, 'the public catalog is console only');
reset role;

-- Writes: staff only, each with an audit_log row.
create temp table audit_before as select count(*) as n from public.audit_log;
select throws_ok($$ select public.xray_confirm_stores((select xray from ids), (select dono from ids)) $$,
  '42501', null, '04 §5: a portal person cannot change an X-ray');
select throws_ok($$ select public.xray_create('nao-e-uuid', 'x', 3, '{}', '{}', (select marlon from ids)) $$,
  '22023', null, 'D29: the store id must be the iFood uuid');

select lives_ok($$ select public.xray_create('91a9c35d-0000-4000-8000-000000000000',
  'https://www.ifood.com.br/delivery/londrina-pr/pantanos-burguer-igapo/91a9c35d-0000-4000-8000-000000000000',
  3, array['Lanches'], '{"exclude_closed": true}', (select marlon from ids), '127.0.0.1', 'pgtap') $$, 'C02: xray_create');
select results_eq($$
  select x.status::text, a.code, x.radius_km from public.xray x join public.account a on a.id = x.account_id
  where x.created_by = (select marlon from ids) and x.id <> (select xray from ids)
$$, $$ values ('collecting', 'G-01', 3) $$, 'C02: new X-ray in collecting, linked to the account of the store (D29)');
select is((select count(*)::int from public.public_store where external_id = '91a9c35d-0000-4000-8000-000000000000'), 1,
  'C02: the target store is not duplicated in the public catalog');
select lives_ok($$ select public.xray_create('0b6f6f2e-1111-4222-8333-944455556666', 'https://www.ifood.com.br/delivery/x/y/0b6f6f2e-1111-4222-8333-944455556666',
  2, array['Hambúrguer'], '{}', (select marlon from ids)) $$, 'C02: a lead store');
select is((select account_id from public.xray x join public.public_store s on s.id = x.target_store_id
           where s.external_id = '0b6f6f2e-1111-4222-8333-944455556666'), null::uuid, 'C02: a lead has no account');

-- C03 toggle.
create temp table one_store as select id from public.xray_store
  where xray_id = (select xray from ids) and included order by distance_m limit 1;
select lives_ok($$ select public.xray_store_set_included((select id from one_store), false, (select marlon from ids)) $$, 'C03: toggle out');
select results_eq($$ select included, exclusion_reason from public.xray_store where id = (select id from one_store) $$,
  $$ values (false, 'manual') $$, 'C03: toggled store is out, reason manual');
select results_eq($$ select action, before ->> 'included', after ->> 'included' from public.audit_log
  where entity_id = (select id from one_store) $$, $$ values ('xray_store.set_included', 'true', 'false') $$,
  'A04: the toggle writes audit_log with before and after');

-- C04 review, skip, calculate.
create temp table sundae as select i.id from public.xray_item i join public.public_menu_item m on m.id = i.public_menu_item_id
  where i.xray_id = (select xray from ids) and m.name = 'Sundae';
update public.xray_item set reviewed_at = null, reviewed_by = null where id = (select id from sundae);
select throws_ok($$ select public.xray_calculate((select xray from ids), (select marlon from ids)) $$,
  '23514', null, 'C04: Calcular raio-X is refused while an item is still to review');
select lives_ok($$ select public.xray_item_set_skipped((select id from sundae), true, (select marlon from ids)) $$, 'C04: skip');
select lives_ok($$ select public.xray_calculate((select xray from ids), (select marlon from ids)) $$,
  'C04: a skipped item does not block the calculation');
select lives_ok($$ select public.xray_item_review((select id from sundae),
  (select array_agg(id) from public.xray_pair where xray_item_id = (select id from sundae) and similarity = 1), (select marlon from ids)) $$,
  'C04: review with the accepted pairs');
select results_eq($$ select (count(*) filter (where accepted))::int, bool_and(by is not null) from public.xray_pair
  where xray_item_id = (select id from sundae) $$, $$ values (2, true) $$, 'C04: review sets accepted and by on every pair');
select results_eq($$ select skipped, reviewed_by = (select marlon from ids) from public.xray_item where id = (select id from sundae) $$,
  $$ values (false, true) $$, 'C04: review clears the skip and records who');

-- C05, C06.
select lives_ok($$ select public.xray_prepare_delivery((select xray from ids), (select marlon from ids)) $$, 'C05: prepare delivery');
select lives_ok($$ select public.xray_mark_delivered((select xray from ids), 'Oi!', (select marlon from ids)) $$, 'C06: delivered');
select ok((select status = 'delivered' and delivered_at > now() - interval '1 minute' from public.xray where id = (select xray from ids)),
  'C06: status delivered with the send time');
select lives_ok($$ select public.time_log_save((select xray from ids), '{"vizinhanca": 36, "entrega": 18}', (select marlon from ids)) $$,
  'C06: save hours');
select results_eq($$ select step, minutes from public.time_log where xray_id = (select xray from ids) order by step $$,
  $$ values ('entrega', 18), ('pareamento', 60), ('vizinhanca', 36) $$, 'C06: hours replace this person''s value per step');
select is((select count(*)::int from public.audit_log) - (select n from audit_before)::int, 9,
  'A04: every successful write wrote one audit_log row');

select * from finish();
rollback;
