-- G-SYN September close of Grupo Exemplo (C03, C08, C09, C16, P06): every drawn number, to the centavo.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

create temp view g02 as select id from public.account where code = 'G-02';
create temp view sept as
  select cs.channel::text as channel, cl.* from public.close_line cl
  join public.close_period cp on cp.id = cl.close_period_id join public.channel_store cs on cs.id = cl.channel_store_id
  where cp.account_id = (select id from g02) and cp.month = '2026-09-01';

-- C08, P06: per channel, as drawn.
select results_eq($$
  select channel, sum(gross_cents), sum(commission_cents), sum(payment_cents), sum(delivery_cents), sum(promotion_cents),
         sum(anticipation_cents), sum(payout_cents)
  from sept group by channel order by channel
$$, $$ values
  ('food99', 1860000::numeric, -167400::numeric, -59500::numeric, -130200::numeric, -55800::numeric, 0::numeric, 1447100::numeric),
  ('ifood', 9240000::numeric, -1108800::numeric, -295700::numeric, -462000::numeric, -369600::numeric, -121000::numeric, 6882900::numeric)
$$, 'C08: iFood and 99Food rows of the September close');
select results_eq($$ select sum(gross_cents), sum(payout_cents) from sept $$,
  $$ values (11100000::numeric, 8330000::numeric) $$, 'C08 total, P06 "Você vendeu R$ 111.000 ... e recebeu R$ 83.300"');
select results_eq($$
  select channel, round(100.0 * sum(payout_cents) / sum(gross_cents), 1) from sept group by channel order by channel
$$, $$ values ('food99', 77.8), ('ifood', 74.5) $$, 'C08 % do bruto');

-- C08 "Done when": the payout column equals the sum of payout entries for the month.
select is((select sum(payout_cents) from sept),
  (select sum(amount_cents) from public.ledger_entry le join public.channel_store cs on cs.id = le.channel_store_id
   join public.kitchen k on k.id = cs.kitchen_id and k.in_analysis
   where le.account_id = (select id from g02) and le.type = 'payout' and le.entry_date between '2026-09-01' and '2026-09-30'),
  'C08: payout equals the payout entries of September');

-- C09: six differences shown, as drawn.
select results_eq($$
  select d.rule_id, d.description, cs.channel::text, d.orders_count, d.amount_cents, d.confidence::text
  from public.difference d join public.channel_store cs on cs.id = d.channel_store_id
  where d.account_id = (select id from g02) and d.shown order by d.amount_cents desc
$$, $$ values
  ('DIF-01', 'Comissão de 15% onde o contrato diz 12%', 'ifood', 214, 41200::bigint, 'certa'),
  ('DIF-02', 'Cancelamento pelo cliente cobrado da loja', 'ifood', 9, 23800::bigint, 'certa'),
  ('DIF-03', 'Cupom cofinanciado debitado inteiro da loja', 'ifood', 31, 18600::bigint, 'certa'),
  ('DIF-03', 'Promoção da semana sem acordo registrado', 'ifood', 22, 14800::bigint, 'provavel'),
  ('DIF-02', 'Cancelamento por atraso do entregador', 'food99', 5, 12000::bigint, 'certa'),
  ('DIF-04', 'Repasse da semana 37 menor que a apuração', 'food99', 1, 8000::bigint, 'provavel')
$$, 'C09: rule, what happened, channel, orders, value, confidence');
select results_eq($$
  select sum(amount_cents) filter (where confidence = 'certa'), count(*) filter (where confidence = 'certa'),
         sum(amount_cents) filter (where confidence = 'provavel'), count(*) filter (where confidence = 'provavel')
  from public.difference where account_id = (select id from g02) and shown
$$, $$ values (95600::numeric, 4::bigint, 22800::numeric, 2::bigint) $$, 'C08, C09: R$ 956 certas (4), R$ 228 prováveis (2), R$ 1.184 in all');
select is((select round(100.0 * 95600 / sum(gross_cents), 1) from sept), 0.9, 'C09: 0,9% do bruto de delivery no mês');
select is_empty($$
  select d.id from public.difference d where d.account_id = (select id from g02)
  and d.orders_count <> (select count(*) from public.difference_order o where o.difference_id = d.id)
$$, 'C03: each difference lists its orders');
select is_empty($$
  select d.id from public.difference d where d.account_id = (select id from g02)
  and d.amount_cents <> (select sum(amount_cents) from public.difference_order o where o.difference_id = d.id)
$$, 'C03: the orders add up to the difference');

-- C16, P12: statuses and totals as drawn.
create temp view k as
  select d.rule_id, cs.channel::text as channel, d.amount_cents, c.status::text as status, c.protocol, c.deadline_on,
         c.marked_by_kind::text as kind, c.credited_entry_id
  from public.difference d join public.channel_store cs on cs.id = d.channel_store_id
  left join public.contestation c on c.difference_id = d.id where d.account_id = (select id from g02);
select results_eq($$ select status, sum(amount_cents) from k group by status order by status $$,
  $$ values ('a_contestar', 30600::numeric), ('contestada', 41200::numeric), ('creditada', 23800::numeric),
            ('precisa_resposta', 14800::numeric), (null, 8000::numeric) $$,
  'C16: R$ 306 a contestar, R$ 412 em análise, R$ 238 creditada, R$ 228 esperando o dono ou o repasse');
select results_eq($$ select protocol, kind from k where rule_id = 'DIF-01' $$, $$ values ('48213', 'person') $$,
  'C16: DIF-01 contested by the Dono, protocolo 48213');
select results_eq($$
  select kind, le.entry_date, le.amount_cents from k join public.ledger_entry le on le.id = k.credited_entry_id
  where k.status = 'creditada'
$$, $$ values ('system', '2026-10-14'::date, 23800::bigint) $$, 'C16: MargoAI marked creditada from the repasse of 14/out');
select results_eq($$ select rule_id, channel, deadline_on from k where status in ('a_contestar', 'precisa_resposta') order by deadline_on $$,
  $$ values ('DIF-03', 'ifood', '2026-11-15'::date), ('DIF-02', 'food99', '2026-11-20'::date), ('DIF-03', 'ifood', '2026-11-22'::date) $$,
  'C09, C16, P12: deadlines as drawn');
select is((select claim_text from public.contestation c join public.difference d on d.id = c.difference_id
           where d.rule_id = 'DIF-03' and d.confidence = 'certa'),
  'Em setembro, 31 pedidos com o cupom da campanha de 20% tiveram o desconto debitado inteiro da loja. Pelo acordo da campanha, o iFood cofinancia metade. Diferença: R$ 186,00. Segue planilha com os pedidos.',
  'C16: the ready claim text, as drawn');

-- C07, C17: history of 214 runs; the changed 99Food layout waits for mapping with the drawn check block.
select is((select count(*)::int from public.import_run where account_id = (select id from g02)), 214, 'C07: 214 imports');
select results_eq($$
  select rows_total, (log->>'payout_total_file_cents')::bigint, (log->>'payout_total_mapped_cents')::bigint,
         (select count(*) from jsonb_array_elements(log->'columns') c where not (c->>'known')::boolean)
  from public.import_run where status = 'needs_mapping' and account_id = (select id from g02)
$$, $$ values (1022, 1447100::bigint, 1447100::bigint, 3::bigint) $$, 'C17: 1.022 rows, R$ 14.471,00 bate, 3 new columns');

select * from finish();
rollback;
