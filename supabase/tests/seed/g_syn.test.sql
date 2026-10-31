-- G-SYN seed (03 §6, D46): the account, people and console data drawn in design/.
-- Numbers of M1 and M2 (X-ray, September close) join this file when their tables land in wave 1.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- C01: four restaurants in the funnel, all synthetic.
select results_eq($$ select code || ' ' || name from public.account order by code $$,
  array['G-01 Pantanos Burguer', 'G-02 Grupo Exemplo', 'G-03 Grupo B', 'G-04 Grupo C'],
  'C01: four accounts in the funnel');
select ok((select bool_and(is_synthetic) from public.account), 'D46: every seeded account is synthetic');

-- C19, W02, P13: Grupo Exemplo structure.
create temp view g02 as select id from public.account where code = 'G-02';
select is((select count(*)::int from public.company where account_id = (select id from g02)), 2, 'C19: 2 CNPJs');
select results_eq($$ select right(cnpj, 6) from public.company where account_id = (select id from g02) order by cnpj $$,
  array['000110', '000291'], 'C19: CNPJ suffixes /0001-10 and /0002-91 as drawn');
select is((select count(*)::int from public.kitchen where account_id = (select id from g02)), 3, 'C19: 3 kitchens');
select is((select count(*)::int from public.kitchen where account_id = (select id from g02) and in_analysis), 2,
  'C19, P13: 2 of 3 kitchens in analysis');
select results_eq($$ select name from public.kitchen where account_id = (select id from g02) order by name $$,
  array['Cozinha Centro', 'Cozinha Zona Sul', 'Quiosque Shopping'], 'W02: kitchen names');
select is((select count(*)::int from public.brand where account_id = (select id from g02)), 3, 'C19: 3 brands');
select is((select count(*)::int from public.channel_store where account_id = (select id from g02)), 7, 'C19: 7 channel stores');
select is((select count(*)::int from public.channel_store where account_id = (select id from g02) and kitchen_id is null), 1,
  'C19: one new iFood store without kitchen');
select results_eq($$
  select k.name || ' · ' || b.name || ' · ' || cs.channel
  from public.channel_store cs join public.kitchen k on k.id = cs.kitchen_id join public.brand b on b.id = cs.brand_id
  where cs.account_id = (select id from g02) order by 1
$$, array[
  'Cozinha Centro · Burger do Bairro · food99',
  'Cozinha Centro · Burger do Bairro · ifood',
  'Cozinha Centro · Frango Crocante · ifood',
  'Cozinha Zona Sul · Burger do Bairro · food99',
  'Cozinha Zona Sul · Burger do Bairro · ifood',
  'Quiosque Shopping · Milkshake Bar · ifood'
], 'C19: linked stores per kitchen, brand and app');
select ok((select external_id like '3fa85f64-%a6' from public.channel_store where name = 'Burger do Bairro Centro' and channel = 'ifood'),
  'C19: iFood id keeps the drawn prefix and suffix');
select is((select count(*)::int from public.channel_store
           where account_id = (select id from g02) and channel = 'ifood' and authorized), 5,
  'C07: 5 authorized iFood stores');
select is((select external_id from public.channel_store where channel = 'food99' and name like '%Zona Sul'), '99F-551877',
  'C19: 99Food id as drawn');

-- W04, P14: people of Grupo Exemplo.
select results_eq($$
  select p.name || ' · ' || m.role || ' · ' || m.all_kitchens from public.membership m
  join public.person p on p.id = m.person_id where m.account_id = (select id from g02) order by p.name
$$, array['Dono do grupo · dono · true', 'Gerente do Centro · gerente · false', 'Pessoa do financeiro · financeiro · true'],
  'W04: three people with profile and scope');
select results_eq($$
  select k.name from public.membership_kitchen mk join public.kitchen k on k.id = mk.kitchen_id
  join public.membership m on m.id = mk.membership_id join public.person p on p.id = m.person_id
  where p.name = 'Gerente do Centro'
$$, array['Cozinha Centro'], 'W04: Gerente do Centro sees Centro only');
select results_eq($$ select role::text || ' · ' || channel from public.invite where account_id = (select id from g02) and accepted_at is null $$,
  array['financeiro · email'], 'W04: Contador invite pending');
select is((select email from public.person where name = 'Dono do grupo'), 'dono@exemplo.com.br', 'W09: Dono login e-mail');
select is((select count(*)::int from public.session_device sd join public.person p on p.id = sd.person_id
           where p.name = 'Dono do grupo' and sd.revoked_at is null), 3, 'W09: three connected devices');
-- Contestation marks (g_syn_m2.sql) are audited too, but they are not part of the W09 access log.
select is((select count(*)::int from public.audit_log where account_id = (select id from g02) and entity <> 'contestation'), 4,
  'W09: four access log rows');

-- C14: founders and owner authorizations.
select results_eq($$ select p.name || ' · ' || s.role from public.staff s join public.person p on p.id = s.person_id order by p.name $$,
  array['Manuel · fundador', 'Marlon · fundador'], 'C14: two founders');
select is((select count(*)::int from public.owner_authorization), 3, 'C14: authorizations for Pantanos and both G-02 CNPJs');

-- C15: subscriptions and pilot.
select results_eq($$
  select a.code || ' · ' || p.code || ' · ' || s.status || ' · ' || s.units_billed
  from public.subscription s join public.account a on a.id = s.account_id join public.plan p on p.id = s.plan_id order by a.code
$$, array['G-01 · lucro · trial · 1', 'G-02 · lucro · active · 6', 'G-03 · lucro · trial · 3', 'G-04 · raio_x · free · 2'],
  'C15: plan, status and active stores per account');
select is((select sum(s.units_billed * p.price_cents)::bigint from public.subscription s join public.plan p on p.id = s.plan_id
           where s.status = 'active'), 180000::bigint, 'C15: monthly revenue R$ 1.800 (6 stores x R$ 300)');
select is((select billing_unit::text from public.plan where code = 'lucro'), 'channel_store',
  'G-SYN bills per channel store (decision for the seed, D40 still open)');
select is((select pct_months_1_2 from public.pilot p join public.account a on a.id = p.account_id where a.code = 'G-03'),
  0.2000::numeric, 'C15: Grupo B pilot at 20% of credited');

-- C18: BPO partners.
select results_eq($$
  select b.name || ' · ' || count(c.id) from public.bpo_partner b left join public.bpo_client c on c.bpo_partner_id = b.id
  group by b.name order by b.name
$$, array['BPO 01 · 2', 'BPO 02 · 0'], 'C18: BPO 01 with 2 groups, BPO 02 without clients');
select is((select count(*)::int from public.channel_store cs join public.bpo_client c on c.account_id = cs.account_id
           where cs.kitchen_id is not null), 7, 'C18: BPO 01 clients have 7 linked stores');

-- C20: account exceptions.
select results_eq($$
  select o.flag_key || ' · ' || a.code from public.feature_override o join public.account a on a.id = o.account_id
  where o.env = 'sandbox' order by 1
$$, array['bpo.marca_propria · G-01', 'bpo.marca_propria · G-02', 'm2.ifood_api · G-03', 'm3.nfce_qr_auto · G-01'],
  'C20: exceptions as drawn');

-- C21: seven open alerts.
select results_eq($$ select a.severity::text, count(*)::int from public.alert a where a.resolved_at is null group by a.severity order by a.severity $$,
  $$ values ('urgente', 2), ('medio', 3), ('baixo', 2) $$, 'C21: 2 urgent, 3 medium, 2 low');

select * from finish();
rollback;
