-- M3 schema (03 §4, 04 §4, 06 §5, D11, D14): tables, constraints, params, read-only RLS, private bucket.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

-- Tables and key columns (03 §4).
select has_table('public', t, '03 §4: table ' || t) from unnest(array[
  'invoice', 'invoice_line', 'ingredient', 'ingredient_match', 'ingredient_price', 'menu_item', 'recipe',
  'recipe_line', 'packaging_cost', 'contribution'
]) t;
select columns_are('public', 'invoice', array[
  'id', 'account_id', 'company_id', 'access_key', 'model', 'issuer_cnpj', 'issuer_name', 'issued_at', 'total_cents',
  'source', 'xml_path', 'created_at', 'updated_at', 'invoice_import_id'
], '03 §4: invoice columns (invoice_import_id: 20261201000020)');
select hasnt_column('public', 'ingredient', 'account_id', 'D14: ingredient is a global catalog without account_id');
select has_column('public', 'menu_item', 'channel_item_ids', '03 §4: menu_item.channel_item_ids');
select has_column('public', 'menu_item', 'is_top20', '03 §4: menu_item.is_top20');
select col_type_is('public', 'ingredient_price', 'price_per_base_unit_cents', 'numeric', '03 §4: price per base unit is numeric centavos');
select col_type_is('public', 'ingredient', 'gtin', 'text[]', '03 §4: ingredient.gtin text[]');
select col_default_is('public', 'ingredient_match', 'status', 'suggested'::public.match_status,
  'D14: a match starts as a suggestion');
select enum_has_labels('public', 'yield_confidence', array['medido', 'declarado', 'estimado'], 'CST-04 yield confidence');
select enum_has_labels('public', 'invoice_source', array['xml_zip', 'key_typed', 'qr_url', 'whatsapp_photo'], '03 §4 invoice sources');
select col_is_unique('public', 'invoice', 'access_key', 'D11: invoices dedupe by access key');
select col_is_unique('public', 'contribution', array['close_period_id', 'menu_item_id', 'channel', 'campaign_name'],
  'C13: one contribution row per close, dish, channel and campaign (none: the dish without campaign)');

-- Params (04 §4).
select results_eq($$
  select key, value from public.rule_param where key like 'm3.%' order by key
$$, $$ values ('m3.global_rule_min_accounts', 3::numeric), ('m3.price_window_days', 90), ('m3.regional_prior_error_pct', 0.30), ('m3.top_ingredients', 20),
              ('m3.yield_error_pct.declarado', 0.05),
              ('m3.yield_error_pct.estimado', 0.10), ('m3.yield_error_pct.medido', 0.02) $$,
  'CST-01 window, CST-04 yield errors and the D14 global rule threshold are params');

-- RLS: enabled, SELECT only; bucket private.
select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('invoice', 'invoice_line', 'ingredient', 'ingredient_match',
    'ingredient_price', 'recipe', 'recipe_line', 'packaging_cost', 'contribution') and not c.relrowsecurity
$$, 'A02: RLS enabled on every M3 table');
select is_empty($$
  select tablename || ' ' || cmd from pg_policies
  where schemaname = 'public' and tablename in ('invoice', 'invoice_line', 'ingredient', 'ingredient_match',
    'ingredient_price', 'menu_item', 'recipe', 'recipe_line', 'packaging_cost', 'contribution') and cmd <> 'SELECT'
$$, 'A02: M3 tables have SELECT policies only; writes go through workers or audited server actions');
select ok((select not public from storage.buckets where id = 'invoices'), 'invoice XML files live in a private bucket');

-- Access key check digit (06 §5, mod 11).
select ok(app.nfe_access_key_valid('41260900000000000190550010000001231123456789'), '06 §5: valid key accepted');
select ok(not app.nfe_access_key_valid('41260900000000000190550010000001231123456780'), '06 §5: wrong check digit refused');
select ok(not app.nfe_access_key_valid('4126090000000000019055001000000123112345678'), '06 §5: 43 digits refused');
select ok(app.nfe_access_key_valid('35260900000000000190650010000000011123456781'), '06 §5: NFC-e key accepted');

-- Fixture.
insert into public.account (id, name, code) values ('a3000000-0000-0000-0000-000000000001', 'Conta M3', 'T-M3');
insert into public.company (id, account_id, cnpj, legal_name)
  values ('a3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', '00000000000270', 'Empresa M3');
insert into public.brand (id, account_id, name)
  values ('a3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000001', 'Marca M3');
insert into public.menu_item (id, account_id, brand_id, name)
  values ('a3000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000003', 'Burger');
insert into public.close_period (id, account_id, month)
  values ('a3000000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-000000000001', '2026-09-01');
insert into public.ingredient (id, name, category, base_unit)
  values ('a3000000-0000-0000-0000-000000000006', 'Insumo teste M3', 'carnes', 'g');
insert into public.invoice (id, account_id, company_id, access_key, model, issuer_cnpj, issued_at, total_cents, source)
  values ('a3000000-0000-0000-0000-000000000007', 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002',
          '41260900000000000190550010000001231123456789', 55, '00000000000190', '2026-09-05 10:00-03', 5000, 'xml_zip');
insert into public.invoice_line (id, account_id, invoice_id, line_no, description, unit, qty, unit_price_cents, total_cents)
  values ('a3000000-0000-0000-0000-000000000008', 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000007',
          1, 'CARNE MOIDA KG', 'KG', 1, 5000, 5000);

select throws_ok($$
  insert into public.invoice (account_id, company_id, access_key, model, issuer_cnpj, issued_at, total_cents, source)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002',
          '41260900000000000190550010000001231123456789', 55, '00000000000190', now(), 5000, 'key_typed')
$$, '23505', null, 'D11: the same access key twice is refused');
select throws_ok($$
  insert into public.invoice (account_id, company_id, access_key, model, issuer_cnpj, issued_at, total_cents, source)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002',
          '41260900000000000190550010000001231123456780', 55, '00000000000190', now(), 5000, 'key_typed')
$$, '23514', null, '06 §5: a key with a wrong check digit is refused');
select throws_ok($$
  insert into public.invoice (account_id, company_id, access_key, model, issuer_cnpj, issued_at, total_cents, source)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002',
          '41260900000000000190550010000001241123456786', 65, '00000000000190', now(), 5000, 'key_typed')
$$, '23514', null, 'model must match digits 21 and 22 of the key');
select throws_ok($$
  insert into public.invoice (account_id, company_id, access_key, model, issuer_cnpj, issued_at, total_cents, source)
  values ('a3000000-0000-0000-0000-000000000001', (select id from public.company where account_id <> 'a3000000-0000-0000-0000-000000000001' limit 1),
          '41260900000000000190550010000001241123456786', 55, '00000000000190', now(), 5000, 'key_typed')
$$, '23503', null, 'an invoice cannot point at a company of another account');

-- D14: an AI suggestion counts only once a person confirms it; one confirmed match per line.
select lives_ok($$
  insert into public.ingredient_match (account_id, invoice_line_id, ingredient_id, method, confidence)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000008',
          'a3000000-0000-0000-0000-000000000006', 'ai', 0.91)
$$, 'D14: an AI suggestion is stored as suggested');
select throws_ok($$
  update public.ingredient_match set status = 'confirmed', conversion_factor = 1000
  where invoice_line_id = 'a3000000-0000-0000-0000-000000000008'
$$, '23514', null, 'D14: an AI match cannot be confirmed without the person who confirmed it');
select throws_ok($$
  update public.ingredient_match set status = 'confirmed', confirmed_by = (select id from public.person limit 1)
  where invoice_line_id = 'a3000000-0000-0000-0000-000000000008'
$$, '23514', null, 'a confirmed match needs a conversion factor');
insert into public.ingredient (id, name, category, base_unit)
  values ('a3000000-0000-0000-0000-000000000009', 'Insumo teste M3 b', 'carnes', 'g');
insert into public.ingredient_match (account_id, invoice_line_id, ingredient_id, method, status, conversion_factor)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000008', 'a3000000-0000-0000-0000-000000000009', 'manual', 'confirmed', 1000);
select throws_ok($$
  update public.ingredient_match set status = 'confirmed', conversion_factor = 1000, confirmed_by = (select id from public.person limit 1)
  where invoice_line_id = 'a3000000-0000-0000-0000-000000000008' and method = 'ai'
$$, '23505', null, 'one confirmed ingredient per invoice line');

-- Prices: an invoice price points at its line, a regional prior does not (CST-01, CST-02).
select throws_ok($$
  insert into public.ingredient_price (account_id, ingredient_id, price_per_base_unit_cents, observed_on, source)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000006', 5, '2026-09-05', 'invoice')
$$, '23514', null, 'CST-01: an invoice price needs its invoice line');
select lives_ok($$
  insert into public.ingredient_price (account_id, ingredient_id, price_per_base_unit_cents, observed_on, source)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000006', 4.5, '2026-09-01', 'regional_prior')
$$, 'CST-02: a regional prior has no invoice line and may be fractional centavos');

-- Contribution (CTB-01): left is the exact sum of its terms; one row per close, dish and channel.
select throws_ok($$
  insert into public.contribution (account_id, close_period_id, menu_item_id, channel, price_cents, channel_take_cents,
      ingredient_cents, ingredient_error_pct, packaging_cents, left_cents)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-000000000004',
          'ifood', 3000, 900, 938, 0.05, 150, 1000)
$$, '23514', null, 'CTB-01: left = price - channel take - ingredient - packaging');
insert into public.contribution (account_id, close_period_id, menu_item_id, channel, price_cents, channel_take_cents,
    ingredient_cents, ingredient_error_pct, packaging_cents, left_cents)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-000000000004',
          'ifood', 3000, 900, 938, 0.05, 150, 1012);
select throws_ok($$
  insert into public.contribution (account_id, close_period_id, menu_item_id, channel, price_cents, channel_take_cents,
      ingredient_cents, ingredient_error_pct, packaging_cents, left_cents)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-000000000004',
          'ifood', 3000, 900, 938, 0.05, 150, 1012)
$$, '23505', null, 'C13: a second row for the same close, dish and channel is refused');

-- Recipes (D15): one ready recipe per dish.
insert into public.recipe (account_id, menu_item_id, status)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000004', 'ready');
select throws_ok($$
  insert into public.recipe (account_id, menu_item_id, status)
  values ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000004', 'ready')
$$, '23505', null, 'D15: at most one ready recipe per dish');

select * from finish();
rollback;
