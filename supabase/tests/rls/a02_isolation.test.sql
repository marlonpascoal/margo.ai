-- A02: a person of account X cannot read any row of account Y.
-- Also the database side of A03 (Gerente sees only own kitchens) and the console roles of 04 §5.
begin;
create extension if not exists pgtap with schema extensions;

select plan(60);

create schema tests;
grant usage on schema tests to anon, authenticated;

-- Deterministic ids: tests.id('X:kitchen1') is the same uuid on every run.
create function tests.id(tag text) returns uuid language sql immutable as $$ select md5(tag)::uuid $$;

create function tests.person(tag text, email text) returns uuid language plpgsql as $$
begin
  insert into auth.users (id, email) values (tests.id(tag || ':auth'), email);
  insert into public.person (id, auth_user_id, name, email) values (tests.id(tag), tests.id(tag || ':auth'), tag, email);
  return tests.id(tag);
end $$;

-- One row in every table for account `a`, owned by its Dono and its Gerente of kitchen 1.
create function tests.make_account(a text) returns void language plpgsql as $$
declare
  acc uuid := tests.id(a);
  dono uuid := tests.person(a || ':dono', lower(a) || '.dono@teste.local');
  ger uuid := tests.person(a || ':gerente', lower(a) || '.gerente@teste.local');
begin
  insert into public.account (id, name, code, plan_id, is_synthetic)
    values (acc, 'Conta ' || a, 'T-' || a, (select id from public.plan where code = 'lucro'), true);
  insert into public.company (id, account_id, cnpj, legal_name) values (tests.id(a || ':co'), acc, lpad(ascii(a)::text, 14, '0'), 'Empresa ' || a);
  insert into public.kitchen (id, account_id, company_id, name, city, uf) values
    (tests.id(a || ':k1'), acc, tests.id(a || ':co'), 'Cozinha 1', 'Londrina', 'PR'),
    (tests.id(a || ':k2'), acc, tests.id(a || ':co'), 'Cozinha 2', 'Londrina', 'PR');
  insert into public.brand (id, account_id, name) values (tests.id(a || ':brand'), acc, 'Marca ' || a);
  insert into public.channel_store (id, account_id, kitchen_id, brand_id, channel, external_id, name, source) values
    (tests.id(a || ':s1'), acc, tests.id(a || ':k1'), tests.id(a || ':brand'), 'ifood', a || '-s1', 'Loja 1', 'api'),
    (tests.id(a || ':s2'), acc, tests.id(a || ':k2'), tests.id(a || ':brand'), 'ifood', a || '-s2', 'Loja 2', 'api'),
    (tests.id(a || ':s3'), acc, null, null, 'food99', a || '-s3', 'Loja sem cozinha', 'file');
  insert into public.channel_store_url_history (channel_store_id, url) values (tests.id(a || ':s1'), 'https://x/' || a);
  insert into public.membership (id, account_id, person_id, role, all_kitchens) values
    (tests.id(a || ':m-dono'), acc, dono, 'dono', true),
    (tests.id(a || ':m-ger'), acc, ger, 'gerente', false);
  insert into public.membership_kitchen (membership_id, kitchen_id) values (tests.id(a || ':m-ger'), tests.id(a || ':k1'));
  insert into public.invite (account_id, role, channel, destination, token_hash, invited_by)
    values (acc, 'financeiro', 'email', 'fin@teste.local', md5(a || 'invite'), dono);
  insert into public.session_device (person_id, user_agent) values (dono, 'test');
  insert into public.security_lock (account_id, reason, until) values (acc, 'contact_change', now() + interval '1 day');
  insert into public.owner_authorization (account_id, company_id, scope, signed_by, signed_at)
    values (acc, tests.id(a || ':co'), array['m2'], dono, now());
  insert into public.subscription (account_id, plan_id, status) values (acc, (select id from public.plan where code = 'lucro'), 'trial');
  insert into public.billing_event (account_id, asaas_event, asaas_event_id, payload) values (acc, 'PAYMENT_CONFIRMED', a || '-ev', '{}');
  insert into public.billing_invoice (account_id, asaas_payment_id, amount_cents, status) values (acc, a || '-pay', 30000, 'confirmed');
  insert into public.pilot (id, account_id, pct_months_1_2, cap_cents) values (tests.id(a || ':pilot'), acc, 0.2, 100000);
  insert into public.pilot_charge (pilot_id, month, credited_cents, charge_cents) values (tests.id(a || ':pilot'), '2026-09-01', 1000, 200);
  insert into public.bpo_client (bpo_partner_id, account_id) values (tests.id('bpo'), acc);
  insert into public.feature_override (flag_key, env, account_id, value, reason)
    values ('l.painel_dono', 'sandbox', acc, true, 'teste');
  insert into public.feature_flag_log (flag_key, env, account_id, old, new) values ('l.painel_dono', 'sandbox', acc, false, true);
  insert into public.notice_pref (person_id, account_id, notice_code, email, whatsapp) values (dono, acc, 'close_ready', true, false);
  insert into public.notification (account_id, person_id, notice_code, channel, subject, body)
    values (acc, dono, 'close_ready', 'email', 'Fechamento', 'corpo');
  insert into public.alert (severity, title, account_id) values ('medio', 'Alerta ' || a, acc);
  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity) values (dono, 'person', acc, 'test', 'account');
  insert into public.job (type, payload, account_id, dedupe_key) values ('import', '{}', acc, a || '-job');
  insert into public.extension_token (person_id, account_id, token_hash) values (dono, acc, md5(a || 'ext'));
  insert into public.menu_item (account_id, brand_id, name) values (acc, tests.id(a || ':brand'), 'Prato ' || a);
  insert into public.public_store (id, channel, external_id, name) values (tests.id(a || ':pub'), 'ifood', a || '-pub', 'Loja ' || a);
  insert into public.xray (id, account_id, target_store_id) values (tests.id(a || ':xray'), acc, tests.id(a || ':pub'));
  insert into public.time_log (account_id, xray_id, step, minutes, person_id) values (acc, tests.id(a || ':xray'), 'entrega', 10, dono);
  -- M2 (03 §3): one fact, close and contestation per store of kitchen 1 and kitchen 2.
  insert into public.import_source (account_id, channel, kind) values (acc, 'ifood', 'upload');
  insert into public.import_run (id, account_id, trigger, channel) values (tests.id(a || ':run'), acc, 'upload', 'ifood');
  insert into public.contract_terms (account_id, channel_store_id, plan_name, commission_pct, payment_fee_pct, delivery_model, valid_from)
    values (acc, tests.id(a || ':s1'), 'Plano', 0.12, 0.035, 'canal', '2026-01-01');
  insert into public.campaign (id, account_id, channel_store_id, name, discount_pct, channel_share_pct, starts_on, ends_on)
    values (tests.id(a || ':camp'), acc, tests.id(a || ':s1'), 'Cupom', 0.2, 0.5, '2026-09-01', '2026-09-30');
  insert into public.order_fact (id, account_id, channel_store_id, external_order_id, ordered_at, gross_cents, items_cents, status) values
    (tests.id(a || ':o1'), acc, tests.id(a || ':s1'), 'o1', '2026-09-10 12:00-03', 5000, 5000, 'concluido'),
    (tests.id(a || ':o2'), acc, tests.id(a || ':s2'), 'o2', '2026-09-10 12:00-03', 5000, 5000, 'concluido');
  insert into public.order_item_fact (account_id, order_fact_id, line_no, item_name, qty, unit_price_cents)
    values (acc, tests.id(a || ':o1'), 1, 'X-Bacon', 1, 5000);
  insert into public.ledger_entry (account_id, channel_store_id, external_entry_id, order_fact_id, entry_date, type, amount_cents) values
    (acc, tests.id(a || ':s1'), 'o1:commission', tests.id(a || ':o1'), '2026-09-10', 'commission', -600),
    (acc, tests.id(a || ':s2'), 'o2:commission', tests.id(a || ':o2'), '2026-09-10', 'commission', -600);
  insert into public.close_period (id, account_id, month) values (tests.id(a || ':cp'), acc, '2026-09-01');
  insert into public.close_line (account_id, close_period_id, channel_store_id, gross_cents, commission_cents, payment_cents,
      delivery_cents, promotion_cents, anticipation_cents, payout_cents) values
    (acc, tests.id(a || ':cp'), tests.id(a || ':s1'), 5000, -600, 0, 0, 0, 0, 4400),
    (acc, tests.id(a || ':cp'), tests.id(a || ':s2'), 5000, -600, 0, 0, 0, 0, 4400);
  insert into public.difference (id, account_id, close_period_id, channel_store_id, rule_id, finding_key, description,
      orders_count, amount_cents, confidence) values
    (tests.id(a || ':d1'), acc, tests.id(a || ':cp'), tests.id(a || ':s1'), 'DIF-01', 'DIF-01', 'x', 1, 600, 'certa'),
    (tests.id(a || ':d2'), acc, tests.id(a || ':cp'), tests.id(a || ':s2'), 'DIF-01', 'DIF-01', 'x', 1, 600, 'certa');
  insert into public.difference_order (account_id, difference_id, order_fact_id, amount_cents) values
    (acc, tests.id(a || ':d1'), tests.id(a || ':o1'), 600), (acc, tests.id(a || ':d2'), tests.id(a || ':o2'), 600);
  insert into public.contestation (account_id, difference_id, status) values
    (acc, tests.id(a || ':d1'), 'a_contestar'), (acc, tests.id(a || ':d2'), 'a_contestar');
  -- M3 (03 §4): one invoice, matched line, price, recipe, packaging and contribution. Each account
  -- refers to its own catalog ingredient; ingredient 'free' is referenced by nobody.
  insert into public.ingredient (id, name, category, base_unit) values (tests.id(a || ':ing'), 'Insumo ' || a, 'carnes', 'g');
  insert into public.invoice (id, account_id, company_id, access_key, model, issuer_cnpj, issued_at, total_cents, source)
    values (tests.id(a || ':inv'), acc, tests.id(a || ':co'),
            case a when 'X' then '41260900000000000190550010000001231123456789'
                   else '41260900000000000190550010000001241123456786' end,
            55, '00000000000190', '2026-09-05 10:00-03', 5000, 'xml_zip');
  insert into public.invoice_line (id, account_id, invoice_id, line_no, description, unit, qty, unit_price_cents, total_cents)
    values (tests.id(a || ':il'), acc, tests.id(a || ':inv'), 1, 'CARNE MOIDA KG', 'KG', 1, 5000, 5000);
  insert into public.ingredient_match (account_id, invoice_line_id, ingredient_id, method, status, conversion_factor)
    values (acc, tests.id(a || ':il'), tests.id(a || ':ing'), 'rule', 'confirmed', 1000);
  insert into public.ingredient_price (account_id, ingredient_id, price_per_base_unit_cents, observed_on, source, invoice_line_id)
    values (acc, tests.id(a || ':ing'), 5, '2026-09-05', 'invoice', tests.id(a || ':il'));
  insert into public.invoice_import (account_id, file_path, status) values (acc, 'invoices/' || a || '/zips/t.zip', 'ok');
  insert into public.ingredient_account_rule (account_id, ingredient_id, keywords, ncm_prefix, unit)
    values (acc, tests.id(a || ':ing'), array['CARNE', 'MOIDA'], '0201', 'KG');
  insert into public.menu_item (id, account_id, brand_id, name) values (tests.id(a || ':dish'), acc, tests.id(a || ':brand'), 'Burger ' || a);
  insert into public.recipe (id, account_id, menu_item_id, status) values (tests.id(a || ':rec'), acc, tests.id(a || ':dish'), 'ready');
  insert into public.recipe_line (account_id, recipe_id, ingredient_id, qty_base_units, yield_pct, yield_confidence)
    values (acc, tests.id(a || ':rec'), tests.id(a || ':ing'), 150, 0.8, 'declarado');
  insert into public.packaging_cost (account_id, menu_item_id, channel, cost_cents) values (acc, tests.id(a || ':dish'), 'ifood', 150);
  insert into public.contribution (account_id, close_period_id, menu_item_id, channel, price_cents, channel_take_cents,
      ingredient_cents, ingredient_error_pct, packaging_cents, left_cents, left_pct)
    values (acc, tests.id(a || ':cp'), tests.id(a || ':dish'), 'ifood', 3000, 900, 938, 0.05, 150, 1012, 0.3373);
  insert into public.campaign_item (account_id, campaign_id, menu_item_id) values (acc, tests.id(a || ':camp'), tests.id(a || ':dish'));
  insert into public.close_cost_line (account_id, close_period_id, channel_store_id, units, ingredient_cents) values
    (acc, tests.id(a || ':cp'), tests.id(a || ':s1'), 1, 938), (acc, tests.id(a || ':cp'), tests.id(a || ':s2'), 1, 938);
  insert into public.close_decision (close_period_id, account_id, kind, menu_item_id, channel, left_cents)
    values (tests.id(a || ':cp'), acc, 'lowest', tests.id(a || ':dish'), 'ifood', 1012);
end $$;

-- Tables with an account_id column where account `acc` has no row (fixture guard).
create function tests.tables_without_rows(acc uuid) returns setof text language plpgsql as $$
declare t text; n int;
begin
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
           where c.table_schema = 'public' and c.column_name = 'account_id' and tb.table_type = 'BASE TABLE' loop
    execute format('select count(*) from public.%I where account_id = $1', t) into n using acc;
    if n = 0 then return next t; end if;
  end loop;
end $$;

-- Tables with an account_id column where the current role can read a row of account `acc`.
create function tests.leaks(acc uuid) returns setof text language plpgsql as $$
declare t text; n int;
begin
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
           where c.table_schema = 'public' and c.column_name = 'account_id' and tb.table_type = 'BASE TABLE' loop
    execute format('select count(*) from public.%I where account_id = $1', t) into n using acc;
    if n > 0 then return next t; end if;
  end loop;
end $$;

create function tests.login(tag text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.id(tag || ':auth'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function tests.n(q text) returns int language plpgsql as $$
declare r int; begin execute 'select count(*) from (' || q || ') q' into r; return r; end $$;

grant execute on all functions in schema tests to anon, authenticated;

insert into public.bpo_partner (id, name) values (tests.id('bpo'), 'BPO Teste');
select tests.make_account('X');
select tests.make_account('Y');
select tests.person('fundador', 'fundador@teste.local');
select tests.person('operacao', 'operacao@teste.local');
select tests.person('sem-conta', 'nada@teste.local');
insert into public.staff (person_id, role) values (tests.id('fundador'), 'fundador'), (tests.id('operacao'), 'operacao');
insert into public.ingredient (id, name, category, base_unit) values (tests.id('free'), 'Insumo sem uso', 'laticinios', 'g');

select is_empty($$ select tests.tables_without_rows(tests.id('Y')) $$,
  'fixture: account Y has a row in every table with account_id');

-- Dono of X.
select tests.login('X:dono');
select is_empty($$ select tests.leaks(tests.id('Y')) $$, 'A02: Dono of X reads no row of Y in any account table');
select is(tests.n($$ select 1 from public.person where id in (tests.id('Y:dono'), tests.id('Y:gerente')) $$), 0, 'A02: Dono of X sees no person of Y');
select is(tests.n($$ select 1 from public.membership_kitchen mk where mk.membership_id = tests.id('Y:m-ger') $$), 0, 'A02: no membership_kitchen of Y');
select is(tests.n($$ select 1 from public.channel_store_url_history where channel_store_id = tests.id('Y:s1') $$), 0, 'A02: no URL history of Y');
select is(tests.n($$ select 1 from public.pilot_charge where pilot_id = tests.id('Y:pilot') $$), 0, 'A02: no pilot charge of Y');
select is(tests.n($$ select 1 from public.session_device where person_id = tests.id('Y:dono') $$), 0, 'A02: no device of Y');
select is(tests.n($$ select 1 from public.kitchen $$), 2, 'Dono sees both own kitchens');
select is(tests.n($$ select 1 from public.channel_store $$), 3, 'Dono sees own stores, including the one without kitchen');
select is(tests.n($$ select 1 from public.membership $$), 2, 'Dono sees every membership of the account');
select is(tests.n($$ select 1 from public.person $$), 2, 'Dono sees the people of the account');
select is(tests.n($$ select 1 from public.subscription $$), 1, 'Dono sees the subscription');
select is(tests.n($$ select 1 from public.billing_invoice $$), 1, 'Dono sees the invoices (W05)');
select is(tests.n($$ select 1 from public.invite $$), 1, 'Dono sees invites');
select is(tests.n($$ select 1 from public.audit_log $$), 1, 'Dono sees the account access log');
select is(tests.n($$ select 1 from public.billing_event $$), 0, 'raw Asaas events are console only');
select is(tests.n($$ select 1 from public.feature_override $$), 0, 'feature overrides are console only');
select is(tests.n($$ select 1 from public.job $$), 0, 'jobs are console only');
select is(tests.n($$ select 1 from public.ingredient $$), 1, 'A02: Dono sees only catalog ingredients own rows refer to');
select is(tests.n($$ select 1 from public.invoice_line $$), 1, 'Dono sees own invoice lines');
select throws_ok($$ insert into public.company (account_id, cnpj, legal_name) values (tests.id('X'), '00000000000999', 'Nova') $$,
  '42501', null, 'portal users cannot write directly; writes go through audited server actions');
select is_empty($$ update public.account set name = 'mudou' where id = tests.id('X') returning id $$,
  'portal users cannot update rows directly');
reset role;

-- Gerente of X, kitchen 1 only (database side of A03).
select tests.login('X:gerente');
select is_empty($$ select tests.leaks(tests.id('Y')) $$, 'A02: Gerente of X reads no row of Y');
select is(tests.n($$ select 1 from public.kitchen $$), 1, 'A03: Gerente sees only own kitchen');
select is(tests.n($$ select 1 from public.channel_store $$), 1, 'A03: Gerente sees only stores of own kitchen');
select is(tests.n($$ select 1 from public.person $$), 1, 'Gerente sees only self in people');
select is(tests.n($$ select 1 from public.membership $$), 1, 'Gerente sees only own membership');
select is(tests.n($$ select 1 from public.subscription $$), 0, 'Gerente does not see the plan');
select is(tests.n($$ select 1 from public.billing_invoice $$), 0, 'Gerente does not see invoices');
select is(tests.n($$ select 1 from public.invite $$), 0, 'Gerente does not see invites');
select is(tests.n($$ select 1 from public.audit_log $$), 0, 'Gerente does not see the access log');
select is(tests.n($$ select 1 from public.order_fact $$), 1, 'A03: Gerente sees orders of own kitchen only');
select is(tests.n($$ select 1 from public.contestation $$), 1, 'A03: Gerente sees contestations of own kitchen only');
select is(tests.n($$ select 1 from public.close_period $$), 0, 'A03: the whole-account close needs all kitchens');
select is(tests.n($$ select 1 from public.import_run $$), 0, 'import history is console only');
select is(tests.n($$ select 1 from public.invoice $$), 1, 'A03: Gerente sees invoices of the company of own kitchen');
select is(tests.n($$ select 1 from public.contribution $$), 0, 'A03: contribution of the whole-account close needs all kitchens');
select is(tests.n($$ select 1 from public.close_cost_line $$), 1, 'A03: W01 insumos of own kitchen stores only');
select is(tests.n($$ select 1 from public.close_decision $$), 0, 'A03: the month''s decision of the whole-account close needs all kitchens');
reset role;

-- Dono of Y, the other direction.
select tests.login('Y:dono');
select is_empty($$ select tests.leaks(tests.id('X')) $$, 'A02: Dono of Y reads no row of X');
reset role;

-- Logged in with no membership.
select tests.login('sem-conta');
select is_empty($$ select tests.leaks(tests.id('X')) $$, 'A02: a person without membership reads nothing of X');
select is_empty($$ select tests.leaks(tests.id('Y')) $$, 'A02: a person without membership reads nothing of Y');
select is(tests.n($$ select 1 from public.person $$), 1, 'and sees only self');
select is(tests.n($$ select 1 from public.ingredient $$), 0, 'a person without membership reads no catalog ingredient');
reset role;

-- Anonymous.
set local role anon;
select is(tests.n($$ select 1 from public.account $$), 0, 'A02: anon reads no account');
select is(tests.n($$ select 1 from public.person $$), 0, 'A02: anon reads no person');
select is(tests.n($$ select 1 from public.plan $$), 3, 'anon reads plans (P07 shows trial days)');
reset role;

-- Console: Operação (04 §5, no billing, secrets or toggles).
select tests.login('operacao');
select is(tests.n($$ select 1 from public.account where id in (tests.id('X'), tests.id('Y')) $$), 2, 'Operação sees every client');
select is(tests.n($$ select 1 from public.alert where account_id in (tests.id('X'), tests.id('Y')) $$), 2, 'Operação sees alerts');
select is(tests.n($$ select 1 from public.subscription $$), 0, 'Operação does not see subscriptions');
select is(tests.n($$ select 1 from public.pilot $$), 0, 'Operação does not see pilots');
select is(tests.n($$ select 1 from public.feature_flag $$), 0, 'Operação does not see feature toggles');
select is(tests.n($$ select 1 from public.ingredient where id in (tests.id('X:ing'), tests.id('Y:ing'), tests.id('free')) $$), 3,
  'Operação reads the whole ingredient catalog (C11 de-para)');
select is(tests.n($$ select 1 from public.invoice where account_id in (tests.id('X'), tests.id('Y')) $$), 2, 'Operação sees every invoice');
reset role;

-- Console: Fundador.
select tests.login('fundador');
select is(tests.n($$ select 1 from public.subscription where account_id in (tests.id('X'), tests.id('Y')) $$), 2, 'Fundador sees subscriptions');
select is(tests.n($$ select 1 from public.billing_event where account_id in (tests.id('X'), tests.id('Y')) $$), 2, 'Fundador sees Asaas events');
select is(tests.n($$ select 1 from public.feature_flag $$), 36, 'Fundador sees feature toggles');
select is_empty($$ update public.feature_flag set default_raio_x = true returning id $$,
  'even Fundador writes only through audited server actions');
reset role;

-- D47c: extraction copies and the street address reach no person, staff included.
reset role;
insert into public.extract_run (id, kind) values (tests.id('run'), 'capture');
insert into public.extract_content (content_hash, payload) values ('h', '{"store": {"address": "Rua Sintética"}}');
insert into public.extract_copy (run_id, channel, store_external_id, collected_at, content_hash)
  values (tests.id('run'), 'ifood', 'x', now(), 'h');
insert into public.public_store_private (public_store_id, address, collected_at)
  values (tests.id('X:pub'), 'Rua Sintética', now());
select tests.login('fundador');
select is(tests.n('select 1 from public.extract_run union all select 1 from public.extract_content union all select 1 from public.extract_copy'), 0,
  'D47c: staff reads no extraction row');
select is(tests.n('select 1 from public.public_store_private'), 0, 'D47c: staff does not read the street address');
reset role;

select * from finish();
rollback;
