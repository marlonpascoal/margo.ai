-- M3 intake (06 §5, §6, D14, C10, C11): import runs, rules, and the confirmation that writes CST-01.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

select has_table('public', 'invoice_import', 'C10: accountant zip runs');
select has_table('public', 'ingredient_rule', 'D14 step 2: global rules');
select hasnt_column('public', 'ingredient_rule', 'account_id', 'D14: rules are global like the catalog');
select is_empty($$
  select tablename || ' ' || cmd from pg_policies
  where schemaname = 'public' and tablename in ('invoice_import', 'ingredient_rule') and cmd <> 'SELECT'
$$, 'A02: SELECT policies only');
select ok(not has_function_privilege('authenticated', 'public.confirm_ingredient_match(uuid, uuid, numeric)', 'execute'),
  'D14: only the service role confirms a match (audited server action or worker)');
select ok(not has_function_privilege('anon', 'public.confirm_ingredient_match(uuid, uuid, numeric)', 'execute'), 'anon cannot confirm');

-- Fixture: one line with an AI suggestion and a rule match on another ingredient.
insert into public.account (id, name, code) values ('a4000000-0000-0000-0000-000000000001', 'Conta Intake', 'T-IN');
insert into public.company (id, account_id, cnpj, legal_name)
  values ('a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', '00000000000270', 'Empresa');
insert into public.ingredient (id, name, category, base_unit) values
  ('a4000000-0000-0000-0000-000000000010', 'Teste cheddar', 'laticínios', 'g'),
  ('a4000000-0000-0000-0000-000000000011', 'Teste prato', 'laticínios', 'g');
insert into public.invoice (id, account_id, company_id, access_key, model, issuer_cnpj, issued_at, total_cents, source)
  values ('a4000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002',
          '41260900000000000190550010000001231123456789', 55, '00000000000190', '2026-10-12 23:30-03', 23654, 'xml_zip');
insert into public.invoice_line (id, account_id, invoice_id, line_no, description, gtin, unit, qty, unit_price_cents, total_cents)
  values ('a4000000-0000-0000-0000-000000000004', 'a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000003',
          1, 'QJO PROC CHED FAT 2,27KG 160FT', '2000000001021', 'PC', 2, 11827, 23654);
insert into public.ingredient_match (id, account_id, invoice_line_id, ingredient_id, method, status, confidence, conversion_factor) values
  ('a4000000-0000-0000-0000-000000000005', 'a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000004',
   'a4000000-0000-0000-0000-000000000010', 'ai', 'suggested', 0.91, 2270),
  ('a4000000-0000-0000-0000-000000000006', 'a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000004',
   'a4000000-0000-0000-0000-000000000011', 'rule', 'suggested', null, 2270);

select throws_ok($$ select public.confirm_ingredient_match('a4000000-0000-0000-0000-000000000005', null, null) $$,
  'P0001', 'person_required', 'D14: an AI suggestion needs a person');
select is((select count(*)::int from public.ingredient_price where account_id = 'a4000000-0000-0000-0000-000000000001'), 0,
  'D02: no price while the suggestion waits');

select public.confirm_ingredient_match('a4000000-0000-0000-0000-000000000005', (select person_id from public.staff limit 1), null);
select results_eq($$
  select round(price_per_base_unit_cents * 1000), observed_on from public.ingredient_price
  where invoice_line_id = 'a4000000-0000-0000-0000-000000000004'
$$, $$ values (5210::numeric, '2026-10-12'::date) $$, 'CST-01: R$ 52,10/kg on the invoice date in São Paulo');
select is((select status::text from public.ingredient_match where id = 'a4000000-0000-0000-0000-000000000006'), 'rejected',
  'one confirmed match per line: the other one is rejected');
select ok((select '2000000001021' = any (gtin) from public.ingredient where id = 'a4000000-0000-0000-0000-000000000010'),
  'D14: the confirmed line GTIN joins the ingredient');

-- Switching to the other ingredient moves the price, never duplicates it.
select public.confirm_ingredient_match('a4000000-0000-0000-0000-000000000006', null, 2270);
select results_eq($$ select ingredient_id from public.ingredient_price where invoice_line_id = 'a4000000-0000-0000-0000-000000000004' $$,
  $$ values ('a4000000-0000-0000-0000-000000000011'::uuid) $$, 'one price per line, of the confirmed match');

select * from finish();
rollback;
