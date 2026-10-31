-- C04 (04 §3, D30): the database accepts every contestation transition of the diagram and no other,
-- and only through public.contestation_mark, which stamps who marked it and writes audit_log.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- All 6 statuses x 6 events x 3 actors: exactly the seven allowed triples.
select results_eq($$
  select s::text, e, a::text, app.contestation_next(s, e, a)
  from unnest(enum_range(null::public.contestation_status)) s,
       unnest(array['ja_contestei', 'foi_combinado_sim', 'foi_combinado_nao', 'credito_encontrado', 'foi_negada', 'prazo_passou']) e,
       unnest(enum_range(null::public.actor_kind)) a
  where app.contestation_next(s, e, a) is not null
  order by 1, 2, 3
$$, $$ values
  ('a_contestar', 'ja_contestei', 'person', 'contestada'),
  ('a_contestar', 'prazo_passou', 'system', 'prazo_vencido'),
  ('contestada', 'credito_encontrado', 'system', 'creditada'),
  ('contestada', 'foi_negada', 'person', 'negada'),
  ('contestada', 'foi_negada', 'staff', 'negada'),
  ('precisa_resposta', 'foi_combinado_nao', 'person', 'a_contestar'),
  ('precisa_resposta', 'foi_combinado_sim', 'person', 'encerrada')
$$, 'C04: every transition of 04 §3 and no other');

-- A contestation of the seed to move around.
create temp table k as
select c.id, c.status from public.contestation c join public.difference d on d.id = c.difference_id
where d.rule_id = 'DIF-03' and d.confidence = 'certa';

select throws_ok($$ update public.contestation set status = 'creditada' where id = (select id from k) $$,
  '42501', null, 'C04: a direct status update is refused');
select throws_ok($$ insert into public.contestation (account_id, difference_id, status)
  select account_id, id, 'creditada' from public.difference where rule_id = 'DIF-04' $$,
  '23514', null, 'C04: a contestation starts as a_contestar or precisa_resposta');
select throws_ok($$ select public.contestation_mark((select id from k), 'credito_encontrado', 'staff', (select id from public.person where email = 'marlon@margoai.com')) $$,
  '23514', null, 'C16: staff cannot set creditada');
select throws_ok($$ select public.contestation_mark((select id from k), 'foi_negada', 'staff', (select id from public.person where email = 'marlon@margoai.com')) $$,
  '23514', null, 'C04: negada only after contestada');

select lives_ok($$ select public.contestation_mark((select id from k), 'ja_contestei', 'person',
  (select id from public.person where email = 'dono@exemplo.com.br'), ' 77001 ') $$, 'the owner marks "Já contestei" with a protocol');
select results_eq($$ select status::text, protocol, marked_by_kind::text from public.contestation where id = (select id from k) $$,
  $$ values ('contestada', '77001', 'person') $$, 'contestada, protocol trimmed, marked by a person');
select is((select count(*)::int from public.audit_log where entity = 'contestation' and entity_id = (select id from k)
  and action = 'contestation.ja_contestei'), 1, 'A04: the transition wrote audit_log');
select lives_ok($$ select public.contestation_mark((select id from k), 'foi_negada', 'staff',
  (select id from public.person where email = 'marlon@margoai.com')) $$, 'C16: staff marks negada when the owner says so');
select is((select status::text from public.contestation where id = (select id from k)), 'negada', 'negada is terminal');

-- "Foi combinado? Sim" closes a probable difference without changing its status.
select lives_ok($$ select public.contestation_mark(c.id, 'foi_combinado_sim', 'person',
  (select id from public.person where email = 'dono@exemplo.com.br'))
  from public.contestation c where c.status = 'precisa_resposta' $$, 'the owner answers it was agreed');
select ok((select closed_at is not null and status = 'precisa_resposta' from public.contestation where status = 'precisa_resposta'),
  '04 §3: closed (no difference)');

select * from finish();
rollback;
