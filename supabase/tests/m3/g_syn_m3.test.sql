-- G-SYN module 3 (C10, C11, C12, C13, P06, W01): the drawn M3 numbers of Grupo Exemplo, to the centavo.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

create temp view g02 as select id from public.account where code = 'G-02';
create temp view inv as select * from public.invoice where account_id = (select id from g02);
create temp view sept as
  select c.*, mi.name from public.contribution c join public.menu_item mi on mi.id = c.menu_item_id
  join public.close_period cp on cp.id = c.close_period_id
  where cp.account_id = (select id from g02) and cp.month = '2026-09-01';

create function pg_temp.cnpj_valid(n text) returns boolean language plpgsql immutable as $$
declare w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2]; s int; d1 int; d2 int;
begin
  s := 0; for i in 1..12 loop s := s + substr(n, i, 1)::int * w1[i]; end loop;
  d1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  s := 0; for i in 1..13 loop s := s + (case when i = 13 then d1 else substr(n, i, 1)::int end) * w2[i]; end loop;
  d2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  return substr(n, 13, 2) = d1::text || d2::text;
end $$;

-- C10: the accountant's folder.
select results_eq($$
  select count(*), count(*) filter (where model = 55), count(*) filter (where model = 65),
         count(distinct issuer_cnpj), count(distinct date_trunc('month', issued_at at time zone 'America/Sao_Paulo'))
  from inv
$$, $$ values (312::bigint, 268::bigint, 44::bigint, 41::bigint, 12::bigint) $$,
  'C10: 312 notas, NF-e 268, NFC-e 44, 41 fornecedores, 12 meses');
select ok((select bool_and(app.nfe_access_key_valid(access_key)) from inv), '06 §5: every access key passes the check digit');
select is_empty($$ select issuer_cnpj from inv where pg_temp.cnpj_valid(issuer_cnpj) $$,
  'A06: issuer CNPJs are synthetic, with wrong check digits');
select results_eq($$
  select i.name, il.unit_price_cents, il.qty, to_char(iv.issued_at at time zone 'America/Sao_Paulo', 'DD/MM'), iv.model
  from public.ingredient_match im join public.invoice_line il on il.id = im.invoice_line_id
  join public.invoice iv on iv.id = il.invoice_id join public.ingredient i on i.id = im.ingredient_id
  join public.ingredient_price ip on ip.invoice_line_id = il.id
  where im.account_id = (select id from g02) and im.status = 'confirmed'
    and il.description in ('CARNE BOV MOIDA PATINHO/ACEM 80/20 KG', 'BAT PRE FRITA CONG 2,5KG PALITO 9MM', 'REFRIG COCA COLA LT 350ML', 'OLEO SOJA 900ML')
    and ip.observed_on = (select max(p2.observed_on) from public.ingredient_price p2
                          where p2.ingredient_id = im.ingredient_id and p2.account_id = im.account_id and p2.source = 'invoice')
  order by 1
$$, $$ values ('Batata congelada palito', 3550::bigint, 12::numeric, '08/10', 55::smallint),
              ('Carne bovina moída (blend)', 3890::bigint, 40::numeric, '12/10', 55::smallint),
              ('Óleo de soja', 756::bigint, 20::numeric, '21/09', 55::smallint),
              ('Refrigerante lata 350 ml', 285::bigint, 24::numeric, '03/10', 65::smallint) $$,
  'C10: R$ 38,90/kg nota de 12/out, R$ 14,20/kg 08/out, R$ 2,85/un cupom de 03/out, R$ 8,40/l 21/set');

-- C11: shares of spend and the drawn rows.
select results_eq($$
  with l as (
    select il.total_cents,
      case when exists (select 1 from public.ingredient_match m where m.invoice_line_id = il.id and m.status = 'confirmed' and m.method in ('gtin', 'rule')) then 'auto'
           when exists (select 1 from public.ingredient_match m where m.invoice_line_id = il.id and m.status = 'suggested' and m.method = 'ai') then 'ia'
           else 'sem' end as kind
    from public.invoice_line il where il.account_id = (select id from g02))
  select kind, round(100.0 * sum(total_cents) / (select sum(total_cents) from l)) from l group by kind order by kind
$$, $$ values ('auto', 72::numeric), ('ia', 15::numeric), ('sem', 13::numeric) $$, 'C11: 72% casado sem mão, 15% sugerido pela IA, 13% sem par');
select results_eq($$
  select distinct il.description, i.name, im.method::text, coalesce(im.rule_note, ''), im.status::text,
         round(il.unit_price_cents / im.conversion_factor * case when i.base_unit = 'un' then 1 else 1000 end)::int
  from public.ingredient_match im join public.invoice_line il on il.id = im.invoice_line_id
  join public.ingredient i on i.id = im.ingredient_id
  where im.account_id = (select id from g02) and il.description in ('CARNE BOV MOIDA PATINHO/ACEM 80/20 KG', 'REFRIG COCA COLA LT 350ML',
    'BAT PRE FRITA CONG 2,5KG PALITO 9MM', 'QJO PROC CHED FAT 2,27KG 160FT', 'MAION TEMP CASA 3KG BALDE', 'PAO HAMB BRIOCHE GERG C/12')
    and (im.status = 'suggested' or il.unit_price_cents in (3890, 285, 3550))
  order by 1
$$, $$ values
  ('BAT PRE FRITA CONG 2,5KG PALITO 9MM', 'Batata congelada palito', 'rule', 'texto + unidade', 'confirmed', 1420),
  ('CARNE BOV MOIDA PATINHO/ACEM 80/20 KG', 'Carne bovina moída (blend)', 'rule', 'texto + NCM 0201', 'confirmed', 3890),
  ('MAION TEMP CASA 3KG BALDE', 'Maionese (base de molho)', 'ai', '', 'suggested', 1130),
  ('PAO HAMB BRIOCHE GERG C/12', 'Pão brioche', 'ai', '', 'suggested', 115),
  ('QJO PROC CHED FAT 2,27KG 160FT', 'Queijo cheddar fatiado', 'ai', '', 'suggested', 5210),
  ('REFRIG COCA COLA LT 350ML', 'Refrigerante lata 350 ml', 'gtin', '', 'confirmed', 285)
$$, 'C11: the drawn rows, price per kg or un');
select is_empty($$
  select ip.id from public.ingredient_price ip join public.ingredient_match im on im.invoice_line_id = ip.invoice_line_id
  where ip.account_id = (select id from g02) and im.status <> 'confirmed'
$$, 'D14: no price comes from a suggested or rejected match');
select ok((select count(*) > 0 from public.ingredient_match where account_id = (select id from g02) and status = 'rejected'),
  'C11: some AI suggestions were rejected (the line stays sem par)');

-- C12: fichas.
select results_eq($$
  select count(*) filter (where r.status = 'ready'), count(*)
  from public.menu_item mi left join public.recipe r on r.menu_item_id = mi.id
  where mi.account_id = (select id from g02) and mi.is_top20
$$, $$ values (8::bigint, 20::bigint) $$, 'C12: 8 de 20 fichas prontas');
select results_eq($$
  select mi.name from public.menu_item mi where mi.account_id = (select id from g02) and mi.top20_rank <= 7 order by mi.top20_rank
$$, $$ values ('X-Bacon artesanal'), ('Smash duplo'), ('Batata frita média'), ('Combo casal'), ('Milkshake 400 ml'),
              ('Cheddar burger'), ('Onion rings') $$, 'C12: dish list in the drawn order');
select results_eq($$
  select r.cost_cents, round(r.error_pct * 100)::int from public.recipe r join public.menu_item mi on mi.id = r.menu_item_id
  where mi.account_id = (select id from g02) and mi.name = 'X-Bacon artesanal'
$$, $$ values (1244::bigint, 9) $$, 'C12: X-Bacon artesanal custo R$ 12,44 ± 9%');
select results_eq($$
  select i.name, rl.qty_base_units, rl.yield_pct, rl.price_source::text, to_char(rl.price_observed_on, 'DD/MM'), round(rl.cost_cents)::int
  from public.recipe_line rl join public.recipe r on r.id = rl.recipe_id join public.menu_item mi on mi.id = r.menu_item_id
  join public.ingredient i on i.id = rl.ingredient_id
  where mi.account_id = (select id from g02) and mi.name = 'X-Bacon artesanal' order by rl.created_at
$$, $$ values
  ('Carne bovina moída (blend)', 160::numeric, 0.85::numeric(7,4), 'invoice', '12/10', 732),
  ('Queijo cheddar fatiado', 28::numeric, 1::numeric(7,4), 'invoice', '30/09', 146),
  ('Bacon em cubos', 30::numeric, 1::numeric(7,4), 'regional_prior', '01/10', 138),
  ('Pão brioche', 1::numeric, 1::numeric(7,4), 'invoice', '05/10', 115),
  ('Maionese (base de molho)', 20::numeric, 1::numeric(7,4), 'invoice', '18/09', 23),
  ('Embalagem kraft', 1::numeric, 1::numeric(7,4), 'regional_prior', '01/10', 90)
$$, 'C12: lines, yield, price source and cost as drawn');
select ok((select r1.error_pct > r2.error_pct from public.recipe r1, public.recipe r2
           where r1.menu_item_id = (select id from public.menu_item where name = 'X-Bacon artesanal' and account_id = (select id from g02))
             and r2.menu_item_id = (select id from public.menu_item where name = 'Batata frita média' and account_id = (select id from g02))),
  'C12 "Done when": a dish with regional priors has a wider error bar than one fully from invoices');

-- C13: contribution per dish and channel. CTB-01 as 04 §4 writes it (commission, payment fee, store share of the
-- coupon co-funded 50/50 as M2 records it); the drawing used the channel's whole share, so these differ from it.
select results_eq($$
  select name, channel::text, campaign_name, price_cents, channel_take_cents, ingredient_cents + packaging_cents, left_cents,
         round(left_pct * 100)::int
  from sept where name in ('X-Bacon artesanal', 'Combo casal', 'Batata frita média', 'Refrigerante lata') and channel in ('ifood', 'food99')
  order by name, channel desc, campaign_name nulls first
$$, $$ values
  ('Batata frita média', 'ifood', null, 1490::bigint, 226::bigint, 310::bigint, 954::bigint, 64),
  ('Combo casal', 'ifood', null, 7990::bigint, 1214::bigint, 3180::bigint, 3596::bigint, 45),
  ('Combo casal', 'ifood', 'Cupom 20% cofinanciado', 7990::bigint, 1962::bigint, 3180::bigint, 2848::bigint, 36),
  ('Refrigerante lata', 'ifood', null, 500::bigint, 76::bigint, 285::bigint, 139::bigint, 28),
  ('X-Bacon artesanal', 'ifood', null, 3690::bigint, 561::bigint, 1244::bigint, 1885::bigint, 51),
  ('X-Bacon artesanal', 'food99', null, 3690::bigint, 450::bigint, 1244::bigint, 1996::bigint, 54)
$$, 'D03 C13: rows by CTB-01 (preço, canal leva, insumos, sobra, % do preço)');
select is((select round(max(ingredient_error_pct) * 100)::int from sept), 9, 'C13, P06: "barra de erro de ± 9%"');
select is_empty($$ select name from sept where can_invert $$, 'C13 CTB-02: "não inverte nenhuma linha"');
select ok((select bool_and(prices_as_of = '2026-10-30') from sept), 'C13: prices as of 30/out, the same as C12');

-- DLV-01: the decision (C13, P06, W01).
select results_eq($$
  select d.kind::text, mi.name, d.channel::text, round(d.campaign_discount_pct * 100)::int, d.left_cents, d.base_left_cents
  from public.close_decision d join public.menu_item mi on mi.id = d.menu_item_id
  join public.close_period cp on cp.id = d.close_period_id where cp.account_id = (select id from g02)
$$, $$ values ('campaign', 'Combo casal', 'ifood', 20, 2848::bigint, 3596::bigint) $$,
  'DLV-01: "O cupom de 20% no Combo casal derruba a contribuição de R$ 35,96 para R$ 28,48"');

-- P06 "16 de 20 itens com preço de nota. Os outros 4 por estimativa da região."
select results_eq($$
  select count(distinct rl.ingredient_id) filter (where rl.price_source = 'invoice'),
         count(distinct rl.ingredient_id) filter (where rl.price_source = 'regional_prior')
  from public.recipe_line rl join public.recipe r on r.id = rl.recipe_id
  where r.account_id = (select id from g02) and r.status = 'ready'
$$, $$ values (16::bigint, 4::bigint) $$, 'P06, C10: 16 de 20 insumos com preço de nota, 4 por estimativa regional');
select results_eq($$
  select i.name from public.ingredient i where exists (
    select 1 from public.recipe_line rl join public.recipe r on r.id = rl.recipe_id
    where rl.ingredient_id = i.id and r.account_id = (select id from g02) and rl.price_source = 'regional_prior') order by 1
$$, $$ values ('Bacon em cubos'), ('Balde de papel'), ('Copo 400 ml com tampa'), ('Embalagem kraft') $$,
  'C10: the four top-20 insumos still without a note');

-- W01: insumos per store, every dish sold has a ficha.
select results_eq($$
  select count(*), sum(uncovered_units) from public.close_cost_line ccl join public.close_period cp on cp.id = ccl.close_period_id
  where cp.account_id = (select id from g02) and cp.month = '2026-09-01'
$$, $$ values (5::bigint, 0::bigint) $$, 'W01: insumos for the 5 stores of the close, no dish without ficha');
select is((select sum(units)::bigint from public.close_cost_line where account_id = (select id from g02)),
  (select sum(oi.qty)::bigint from public.order_item_fact oi join public.order_fact o on o.id = oi.order_fact_id
   where o.account_id = (select id from g02) and o.status = 'concluido' and o.ordered_at >= '2026-09-01 00:00-03' and o.ordered_at < '2026-10-01 00:00-03'),
  'W01: units of the store costs are the dishes of the September orders');
select is((select sum(units)::bigint from sept), (select sum(units)::bigint from public.close_cost_line where account_id = (select id from g02)),
  'C13 units add up to the units of W01');
select is((select sum(ingredient_cents)::bigint from public.close_cost_line where account_id = (select id from g02)),
  (select sum(units * ingredient_cents)::bigint from sept), 'W01 insumos equal C13 units times insumos');

select * from finish();
rollback;
