-- A02: a person of account X cannot read any row of account Y.
-- Also the database side of A03 (Gerente sees only own kitchens) and the console roles of 04 §5.
begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

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
select is(tests.n($$ select 1 from public.invite $$), 1, 'Dono sees invites');
select is(tests.n($$ select 1 from public.audit_log $$), 1, 'Dono sees the account access log');
select is(tests.n($$ select 1 from public.billing_event $$), 0, 'raw Asaas events are console only');
select is(tests.n($$ select 1 from public.feature_override $$), 0, 'feature overrides are console only');
select is(tests.n($$ select 1 from public.job $$), 0, 'jobs are console only');
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
select is(tests.n($$ select 1 from public.invite $$), 0, 'Gerente does not see invites');
select is(tests.n($$ select 1 from public.audit_log $$), 0, 'Gerente does not see the access log');
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
reset role;

-- Anonymous.
set local role anon;
select is(tests.n($$ select 1 from public.account $$), 0, 'A02: anon reads no account');
select is(tests.n($$ select 1 from public.person $$), 0, 'A02: anon reads no person');
select is(tests.n($$ select 1 from public.plan $$), 3, 'anon reads plans (P07 shows trial days)');
reset role;

-- Console: Operação (04 §5, no billing, secrets or toggles).
select tests.login('operacao');
select is(tests.n($$ select 1 from public.account $$), 2, 'Operação sees every client');
select is(tests.n($$ select 1 from public.alert $$), 2, 'Operação sees alerts');
select is(tests.n($$ select 1 from public.subscription $$), 0, 'Operação does not see subscriptions');
select is(tests.n($$ select 1 from public.pilot $$), 0, 'Operação does not see pilots');
select is(tests.n($$ select 1 from public.feature_flag $$), 0, 'Operação does not see feature toggles');
reset role;

-- Console: Fundador.
select tests.login('fundador');
select is(tests.n($$ select 1 from public.subscription $$), 2, 'Fundador sees subscriptions');
select is(tests.n($$ select 1 from public.billing_event $$), 2, 'Fundador sees Asaas events');
select is(tests.n($$ select 1 from public.feature_flag $$), 30, 'Fundador sees feature toggles');
select is_empty($$ update public.feature_flag set default_raio_x = true returning id $$,
  'even Fundador writes only through audited server actions');
reset role;

select * from finish();
rollback;
