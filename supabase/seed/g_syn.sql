-- G-SYN: the synthetic group behind every screen and test (03 §6, D46). Labeled SINTÉTICO.
-- Values follow the drawings in design/; "hoje" in the drawings is 30/out/2026.
-- Wave 0 covers 03 §1 and §5. X-ray (28/out) and September close numbers join when their tables land.
--
-- Choices where the drawings disagree (decided with Marlon, 30/out):
--   G-02 is "Grupo Exemplo" (owner screens, 03 §6); the console drawings call it "Grupo A".
--   G-02 pays Lucro (C15, C21); the trial banner of W01/W05 belongs to Pantanos (P08).
--   Billing per channel store; D40 is still open, so only the seed changes plan.billing_unit.
--   Only channel stores of kitchens in analysis are billed (Marlon, 31/out): G-02 pays 5 stores x R$ 300 =
--   R$ 1.500, not the 6 stores and R$ 1.800 drawn in C15 (Quiosque Shopping is not in analysis).
--   Store layout of C19: Shopping has Milkshake Bar only; the new Burger do Bairro (e801...) has no kitchen.
-- Filled in because no drawing shows them (synthetic, safe to change):
--   CNPJ roots and Pantanos CNPJ (invalid check digits on purpose, so they can never be a real company),
--   full iFood uuids (drawn prefix and suffix kept), WhatsApp numbers (drawn last digits kept),
--   Pantanos code G-01, legal names, Manuel's e-mail, Grupo B and C people.

-- Ids are md5 of a readable tag, stable across resets.
create function pg_temp.sid(tag text) returns uuid language sql immutable as $$ select md5('g-syn:' || tag)::uuid $$;

-- Billing unit for G-SYN (see header).
update public.plan set billing_unit = 'channel_store' where code = 'lucro';

-- Accounts (C01) ----------------------------------------------------------------------------------

insert into public.account (id, name, code, plan_id, trial_ends_at, is_synthetic, created_at) values
  (pg_temp.sid('G-01'), 'Pantanos Burguer', 'G-01', (select id from public.plan where code = 'lucro'),
   '2026-11-08 23:59:59-03', true, '2026-10-25 10:00-03'),
  (pg_temp.sid('G-02'), 'Grupo Exemplo', 'G-02', (select id from public.plan where code = 'lucro'),
   null, true, '2026-10-01 09:00-03'),
  (pg_temp.sid('G-03'), 'Grupo B', 'G-03', (select id from public.plan where code = 'lucro'),
   '2026-11-01 23:59:59-03', true, '2026-10-18 14:00-03'),
  (pg_temp.sid('G-04'), 'Grupo C', 'G-04', (select id from public.plan where code = 'raio_x'),
   null, true, '2026-10-27 11:00-03');

-- People ------------------------------------------------------------------------------------------
-- No auth.users rows: login (task 4) links person.auth_user_id by e-mail on first code.

insert into public.person (id, name, email, whatsapp_e164) values
  (pg_temp.sid('p:marlon'), 'Marlon', 'marlon@margoai.com', null),
  (pg_temp.sid('p:manuel'), 'Manuel', 'manuel@margoai.com', null),
  (pg_temp.sid('p:g02-dono'), 'Dono do grupo', 'dono@exemplo.com.br', '+5543900001234'),
  (pg_temp.sid('p:g02-fin'), 'Pessoa do financeiro', 'financeiro@exemplo.com.br', null),
  (pg_temp.sid('p:g02-ger'), 'Gerente do Centro', null, '+5543900005678'),
  (pg_temp.sid('p:g01-dono'), 'Dono da Pantanos', 'pantanos@exemplo.com.br', null),
  (pg_temp.sid('p:g03-dono'), 'Dono do Grupo B', 'grupob@exemplo.com.br', null),
  (pg_temp.sid('p:g04-dono'), 'Dono do Grupo C', 'grupoc@exemplo.com.br', null);

-- C14: the founders.
insert into public.staff (person_id, role) values
  (pg_temp.sid('p:marlon'), 'fundador'),
  (pg_temp.sid('p:manuel'), 'fundador');

-- Grupo Exemplo, G-02 (C19, W02, P13) -------------------------------------------------------------

insert into public.company (id, account_id, cnpj, legal_name) values
  (pg_temp.sid('G-02:cnpj1'), pg_temp.sid('G-02'), '12345678000110', 'Exemplo Alimentos Ltda'),
  (pg_temp.sid('G-02:cnpj2'), pg_temp.sid('G-02'), '12345678000291', 'Exemplo Alimentos Ltda');

insert into public.kitchen (id, account_id, company_id, name, address, city, uf, in_analysis) values
  (pg_temp.sid('G-02:centro'), pg_temp.sid('G-02'), pg_temp.sid('G-02:cnpj1'), 'Cozinha Centro', 'Rua Exemplo, 100', 'São Paulo', 'SP', true),
  (pg_temp.sid('G-02:zonasul'), pg_temp.sid('G-02'), pg_temp.sid('G-02:cnpj2'), 'Cozinha Zona Sul', 'Av. Exemplo, 2000', 'São Paulo', 'SP', true),
  (pg_temp.sid('G-02:shopping'), pg_temp.sid('G-02'), pg_temp.sid('G-02:cnpj2'), 'Quiosque Shopping', 'Shopping Exemplo', 'São Paulo', 'SP', false);

insert into public.brand (id, account_id, name) values
  (pg_temp.sid('G-02:burger'), pg_temp.sid('G-02'), 'Burger do Bairro'),
  (pg_temp.sid('G-02:frango'), pg_temp.sid('G-02'), 'Frango Crocante'),
  (pg_temp.sid('G-02:milk'), pg_temp.sid('G-02'), 'Milkshake Bar');

insert into public.channel_store
  (id, account_id, kitchen_id, brand_id, channel, external_id, name, public_url, authorized, authorized_at, source, created_at)
values
  (pg_temp.sid('G-02:s1'), pg_temp.sid('G-02'), pg_temp.sid('G-02:centro'), pg_temp.sid('G-02:burger'), 'ifood',
   '3fa85f64-5717-4562-b3fc-2c963f66afa6', 'Burger do Bairro Centro',
   'https://www.ifood.com.br/delivery/sao-paulo-sp/centro-burger-do-bairro/3fa85f64-5717-4562-b3fc-2c963f66afa6',
   true, '2026-10-10 11:00-03', 'api', '2026-10-10 11:05-03'),
  (pg_temp.sid('G-02:s2'), pg_temp.sid('G-02'), pg_temp.sid('G-02:centro'), pg_temp.sid('G-02:frango'), 'ifood',
   '9b1c22d0-4e8a-4c3b-9f21-7d5e0a6b3c41', 'Frango Crocante Centro',
   'https://www.ifood.com.br/delivery/sao-paulo-sp/centro-frango-crocante/9b1c22d0-4e8a-4c3b-9f21-7d5e0a6b3c41',
   true, '2026-10-10 11:00-03', 'api', '2026-10-10 11:05-03'),
  (pg_temp.sid('G-02:s3'), pg_temp.sid('G-02'), pg_temp.sid('G-02:centro'), pg_temp.sid('G-02:burger'), 'food99',
   '99F-551203', 'Burger do Bairro Centro', null,
   true, '2026-10-10 11:00-03', 'file', '2026-10-12 15:00-03'),
  (pg_temp.sid('G-02:s4'), pg_temp.sid('G-02'), pg_temp.sid('G-02:zonasul'), pg_temp.sid('G-02:burger'), 'ifood',
   'c47e0a19-2b6d-4f8e-a135-9c0d7e2f450d', 'Burger do Bairro Zona Sul',
   'https://www.ifood.com.br/delivery/sao-paulo-sp/zona-sul-burger-do-bairro/c47e0a19-2b6d-4f8e-a135-9c0d7e2f450d',
   true, '2026-10-10 11:00-03', 'api', '2026-10-10 11:05-03'),
  (pg_temp.sid('G-02:s5'), pg_temp.sid('G-02'), pg_temp.sid('G-02:zonasul'), pg_temp.sid('G-02:burger'), 'food99',
   '99F-551877', 'Burger do Bairro Zona Sul', null,
   true, '2026-10-10 11:00-03', 'file', '2026-10-12 15:00-03'),
  (pg_temp.sid('G-02:s6'), pg_temp.sid('G-02'), pg_temp.sid('G-02:shopping'), pg_temp.sid('G-02:milk'), 'ifood',
   '5d2f8e3a-91c4-4a7b-8e06-3f2b1d9c6a7c', 'Milkshake Bar Shopping',
   'https://www.ifood.com.br/delivery/sao-paulo-sp/shopping-milkshake-bar/5d2f8e3a-91c4-4a7b-8e06-3f2b1d9c6a7c',
   true, '2026-10-10 11:00-03', 'api', '2026-10-10 11:05-03'),
  -- C19, C21 (29/out): new iFood store, "sem cozinha: vincular".
  (pg_temp.sid('G-02:s7'), pg_temp.sid('G-02'), null, null, 'ifood',
   'e801b6c4-3a5f-4d92-b7e8-0c1f6a4d2e12', 'Burger do Bairro',
   'https://www.ifood.com.br/delivery/sao-paulo-sp/burger-do-bairro-nova/e801b6c4-3a5f-4d92-b7e8-0c1f6a4d2e12',
   true, '2026-10-29 06:00-03', 'api', '2026-10-29 06:00-03');

insert into public.channel_store_url_history (channel_store_id, url, seen_at)
select id, public_url, created_at from public.channel_store where account_id = pg_temp.sid('G-02') and public_url is not null;

-- W04, P14: people and scopes.
insert into public.membership (id, account_id, person_id, role, all_kitchens) values
  (pg_temp.sid('G-02:m-dono'), pg_temp.sid('G-02'), pg_temp.sid('p:g02-dono'), 'dono', true),
  (pg_temp.sid('G-02:m-fin'), pg_temp.sid('G-02'), pg_temp.sid('p:g02-fin'), 'financeiro', true),
  (pg_temp.sid('G-02:m-ger'), pg_temp.sid('G-02'), pg_temp.sid('p:g02-ger'), 'gerente', false);
insert into public.membership_kitchen (membership_id, kitchen_id) values
  (pg_temp.sid('G-02:m-ger'), pg_temp.sid('G-02:centro'));

-- W04: Contador, invite sent 29/out, pending. Token for local tests: "g-syn-convite-contador".
insert into public.invite (account_id, role, kitchen_ids, channel, destination, token_hash, expires_at, invited_by, created_at) values
  (pg_temp.sid('G-02'), 'financeiro', '{}', 'email', 'contador@exemplo.com.br',
   encode(sha256('g-syn-convite-contador'::bytea), 'hex'), '2026-11-05 10:02-03', pg_temp.sid('p:g02-dono'), '2026-10-29 10:02-03');

-- W09: Dono's devices and access log.
insert into public.session_device (person_id, user_agent, ip_city, last_seen_at) values
  (pg_temp.sid('p:g02-dono'), 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'Londrina', '2026-10-30 08:12-03'),
  (pg_temp.sid('p:g02-dono'), 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 'Londrina', '2026-10-29 21:10-03'),
  (pg_temp.sid('p:g02-dono'), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'São Paulo', '2026-10-27 19:30-03');
insert into public.session_device (person_id, user_agent, ip_city, last_seen_at) values
  (pg_temp.sid('p:g02-fin'), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'São Paulo', '2026-10-29 17:40-03'),
  (pg_temp.sid('p:g02-ger'), 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 'São Paulo', '2026-10-27 12:00-03');

insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, after, at) values
  (pg_temp.sid('p:g02-dono'), 'person', pg_temp.sid('G-02'), 'login.new_device', 'session_device', null,
   '{"channel": "email", "device": "Chrome no Windows"}', '2026-10-27 19:30-03'),
  (pg_temp.sid('p:g02-dono'), 'person', pg_temp.sid('G-02'), 'invite.create', 'invite', null,
   '{"role": "financeiro", "name": "Contador"}', '2026-10-29 10:02-03'),
  (pg_temp.sid('p:g02-fin'), 'person', pg_temp.sid('G-02'), 'login', 'person', pg_temp.sid('p:g02-fin'),
   '{"channel": "email"}', '2026-10-29 17:40-03'),
  (pg_temp.sid('p:g02-dono'), 'person', pg_temp.sid('G-02'), 'login', 'person', pg_temp.sid('p:g02-dono'),
   '{"channel": "email"}', '2026-10-30 08:12-03');

-- C14: one authorization per CNPJ, signed 10/out.
insert into public.owner_authorization (account_id, company_id, scope, includes_ai, includes_international, signed_by, signed_at) values
  (pg_temp.sid('G-02'), pg_temp.sid('G-02:cnpj1'), array['ifood', 'food99', 'notas'], true, true, pg_temp.sid('p:g02-dono'), '2026-10-10 11:00-03'),
  (pg_temp.sid('G-02'), pg_temp.sid('G-02:cnpj2'), array['ifood', 'food99', 'notas'], true, true, pg_temp.sid('p:g02-dono'), '2026-10-10 11:00-03');

-- C15: active Lucro. units_billed follows the billing rule (04 §7, D40, SupabaseBillingStore.countUnits):
-- channel stores of kitchens in analysis, 5 here, so the units cron finds nothing to change.
insert into public.subscription (account_id, plan_id, status, asaas_customer_id, asaas_subscription_id, next_due_on, units_billed, last_event, last_event_at) values
  (pg_temp.sid('G-02'), (select id from public.plan where code = 'lucro'), 'active', 'cus_000000g02c', 'sub_00000000a91f',
   '2026-11-05',
   (select count(*) from public.channel_store cs join public.kitchen k on k.id = cs.kitchen_id
     where cs.account_id = pg_temp.sid('G-02') and k.in_analysis),
   'pagamento confirmado', '2026-10-05 09:00-03');

-- Pantanos Burguer, G-01 (D03 test store, P08, C14, C15) -----------------------------------------
-- The iFood uuid is drawn only as 91a9c35d-...; replace with the recorded public page in wave 1, lane A.

insert into public.company (id, account_id, cnpj, legal_name) values
  (pg_temp.sid('G-01:cnpj'), pg_temp.sid('G-01'), '98765432000150', 'Pantanos Burguer Ltda');
insert into public.kitchen (id, account_id, company_id, name, city, uf, in_analysis) values
  (pg_temp.sid('G-01:igapo'), pg_temp.sid('G-01'), pg_temp.sid('G-01:cnpj'), 'Igapó', 'Londrina', 'PR', true);
insert into public.brand (id, account_id, name) values
  (pg_temp.sid('G-01:brand'), pg_temp.sid('G-01'), 'Pantanos Burguer');
insert into public.channel_store
  (id, account_id, kitchen_id, brand_id, channel, external_id, name, public_url, authorized, authorized_at, source, created_at)
values
  (pg_temp.sid('G-01:s1'), pg_temp.sid('G-01'), pg_temp.sid('G-01:igapo'), pg_temp.sid('G-01:brand'), 'ifood',
   '91a9c35d-0000-4000-8000-000000000000', 'Pantanos Burguer Igapó',
   'https://www.ifood.com.br/delivery/londrina-pr/pantanos-burguer-igapo/91a9c35d-0000-4000-8000-000000000000',
   true, '2026-10-29 15:00-03', 'public', '2026-10-25 10:00-03');
insert into public.membership (account_id, person_id, role) values
  (pg_temp.sid('G-01'), pg_temp.sid('p:g01-dono'), 'dono');
insert into public.owner_authorization (account_id, company_id, scope, includes_ai, includes_international, signed_by, signed_at) values
  (pg_temp.sid('G-01'), pg_temp.sid('G-01:cnpj'), array['ifood_api', 'extensao'], true, true, pg_temp.sid('p:g01-dono'), '2026-10-29 15:00-03');
insert into public.subscription (account_id, plan_id, status, asaas_customer_id, units_billed, last_event, last_event_at) values
  (pg_temp.sid('G-01'), (select id from public.plan where code = 'lucro'), 'trial', 'cus_000000077c2', 1,
   'conta criada', '2026-10-25 10:00-03');

-- Grupo B, G-03 (C01 Londrina, 3 stores from the X-ray in wave 1) and Grupo C, G-04 (Maringá) ------

insert into public.membership (account_id, person_id, role) values
  (pg_temp.sid('G-03'), pg_temp.sid('p:g03-dono'), 'dono'),
  (pg_temp.sid('G-04'), pg_temp.sid('p:g04-dono'), 'dono');
insert into public.subscription (account_id, plan_id, status, asaas_customer_id, units_billed, last_event, last_event_at) values
  (pg_temp.sid('G-03'), (select id from public.plan where code = 'lucro'), 'trial', 'cus_0000000b4e', 3,
   'aviso de fim enviado', '2026-10-28 09:00-03'),
  (pg_temp.sid('G-04'), (select id from public.plan where code = 'raio_x'), 'free', null, 2, null, null);

-- C15: Grupo B pilot, 20% of credited in months 1 and 2; cap and fixed value "a definir".
insert into public.pilot (account_id, pct_months_1_2, cap_cents, fixed_from_day_61_cents, started_on) values
  (pg_temp.sid('G-03'), 0.2, null, null, null);

-- C18: BPO partners ---------------------------------------------------------------------------------

insert into public.bpo_partner (id, name, folder_url, show_powered_by, price_per_store_cents) values
  (pg_temp.sid('bpo-01'), 'BPO 01', 'https://drive.exemplo.com.br/bpo-01', true, null),
  (pg_temp.sid('bpo-02'), 'BPO 02', null, true, null);
insert into public.bpo_client (bpo_partner_id, account_id) values
  (pg_temp.sid('bpo-01'), pg_temp.sid('G-02')),
  (pg_temp.sid('bpo-01'), pg_temp.sid('G-01'));

-- C20: account exceptions, both environments --------------------------------------------------------

insert into public.feature_override (flag_key, env, account_id, value, reason, set_by)
select o.flag_key, e.env, o.account_id, true, o.reason, pg_temp.sid('p:marlon')
from (values
  ('m2.ifood_api', pg_temp.sid('G-03'), 'ligada no teste grátis'),
  ('m3.nfce_qr_auto', pg_temp.sid('G-01'), 'só Pantanos, para testar'),
  ('bpo.marca_propria', pg_temp.sid('G-02'), 'BPO 01'),
  ('bpo.marca_propria', pg_temp.sid('G-01'), 'BPO 01')
) as o (flag_key, account_id, reason)
cross join (values ('sandbox'::public.flag_env), ('production'::public.flag_env)) as e (env);

-- C21: open alerts, as drawn -------------------------------------------------------------------------

insert into public.alert (severity, title, account_id, link, notified_via, opened_at) values
  ('urgente', 'Importação da API falhou 2 vezes: token expirado', pg_temp.sid('G-02'),
   '/console/contas/G-02/importacoes', array['email_equipe', 'whatsapp_equipe'], '2026-10-30 06:04-03'),
  ('urgente', 'Cobrança recusada no cartão', pg_temp.sid('G-02'),
   '/console/assinaturas', array['email_equipe', 'email_dono'], '2026-10-30 07:10-03'),
  ('medio', 'Extensão sem enviar há 3 dias', pg_temp.sid('G-01'),
   '/console/contas/G-01/importacoes', array['email_equipe', 'whatsapp_dono'], '2026-10-27 09:00-03'),
  ('medio', 'Prazo de contestação em 3 dias (R$ 186)', pg_temp.sid('G-01'),
   '/console/contas/G-01/contestacoes', array['email_dono', 'whatsapp_dono'], '2026-11-12 09:00-03'),
  ('medio', 'Arquivo da 99Food com colunas novas', pg_temp.sid('G-01'),
   '/console/contas/G-01/importacoes', array['email_equipe'], '2026-10-28 15:02-03'),
  ('baixo', 'Teste grátis acaba em 2 dias, sem plano', pg_temp.sid('G-03'),
   '/console/assinaturas', array['email_dono', 'whatsapp_dono'], '2026-10-28 09:00-03'),
  ('baixo', 'Loja nova no iFood sem cozinha', pg_temp.sid('G-02'),
   '/console/contas/G-02/estrutura', array['email_equipe'], '2026-10-29 06:00-03');
