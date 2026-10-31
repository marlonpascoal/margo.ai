-- G-SYN M1 (03 §6, D46): every number drawn in C03 to C06 and P01 for the Pantanos Burguer X-ray of 28/out,
-- read back from the seeded rows. The rules that produce them are tested in workers/collector (B01).
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

create temp view x as
  select x.* from public.xray x join public.account a on a.id = x.account_id where a.code = 'G-01';
create temp view items as
  select i.*, m.name, m.price_cents as own_cents, (select count(*) from public.xray_pair p where p.xray_item_id = i.id) as k
  from public.xray_item i join public.public_menu_item m on m.id = i.public_menu_item_id
  where i.xray_id = (select id from x);
create temp view hood as select s.*, ps.name, ps.category from public.xray_store s
  join public.public_store ps on ps.id = s.public_store_id where s.xray_id = (select id from x);

-- C02, C06, C01: the run.
select results_eq($$ select ps.name, ps.area, ps.category from public.public_store ps where ps.id = (select target_store_id from x) $$,
  $$ values ('Pantanos Burguer', 'Igapó, Londrina', 'Lanches') $$, 'C02: Loja encontrada: Pantanos Burguer · Igapó, Londrina · Lanches');
select results_eq($$ select radius_km, categories, status::text from x $$,
  $$ values (3, array['Lanches', 'Hambúrguer', 'Porções'], 'delivered') $$, 'C02: 3 km, the drawn categories; C01: delivered');
select is((select to_char(delivered_at at time zone 'America/Sao_Paulo', 'DD/MM') from x), '28/10', 'C01: Entregue 28/out');
select is((select to_char(collected_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') from x), '28/10/2026', 'P01: 28/out/2026');

-- C03.
select is((select count(*)::int from hood), 107, 'C03: 107 lojas encontradas');
select is((select count(*)::int from hood where included), 84, 'C03: 84 no conjunto, Confirmar 84 lojas');
select is((select count(*)::int from hood where not included), 23, 'C03: 23 excluídas');
select is_empty($$ select 1 from hood where not included and exclusion_reason is null $$, 'C03: every excluded store shows its reason');
select ok((select max(distance_m) from hood) <= 3000, 'M1-01: every store within 3 km');
select results_eq($$
  select name, category || ' · ' || replace(to_char(distance_m / 1000.0, 'FM0.0'), '.', ',') || ' km',
         case when included then 'no conjunto' else exclusion_reason end
  from hood where name in ('Loja vizinha 01', 'Loja vizinha 02', 'Loja vizinha 03', 'Rede nacional X', 'Loja vizinha 05',
                           'Loja vizinha 06', 'Loja vizinha 07', 'Loja vizinha 08')
  order by distance_m
$$, $$ values
  ('Loja vizinha 01', 'Hambúrguer · 0,4 km', 'no conjunto'),
  ('Loja vizinha 02', 'Lanches · 0,9 km', 'no conjunto'),
  ('Loja vizinha 03', 'Hambúrguer · 1,2 km', 'no conjunto'),
  ('Rede nacional X', 'Hambúrguer · 1,5 km', 'regra: rede tabelada'),
  ('Loja vizinha 05', 'Porções · 1,8 km', 'no conjunto'),
  ('Loja vizinha 06', 'Lanches · 2,3 km', 'regra: fechada há 40 dias'),
  ('Loja vizinha 07', 'Hambúrguer · 2,6 km', 'no conjunto'),
  ('Loja vizinha 08', 'Pizza · 2,9 km', 'manual: outra categoria')
$$, 'C03: the eight drawn rows');
select is((select count(*)::int from public.public_store ps where ps.name like 'Loja longe%'), 5,
  'M1-01: five collected stores beyond 3 km stay out of the neighborhood');

-- C04.
select is((select count(*)::int from items), 24, 'C04: 24 itens no cardápio');
select is((select count(*)::int from items where pair_status = 'auto'), 19, 'C04: 19 pareados sozinhos');
select is((select count(*)::int from items where pair_status = 'revisar'), 3, 'C04: 3 para revisar');
select is((select count(*)::int from items where pair_status = 'normalizado'), 2, 'C04: 2 normalizados por peso');
select results_eq($$ select name, k::int, norm_unit, pair_status::text, coalesce(pair_note, '') from items
  where name in ('X-Bacon artesanal', 'Batata frita média', 'Refrigerante lata 350 ml', 'Milkshake 400 ml', 'Combo casal',
                 'Molho especial extra', 'Sundae') order by name $$,
  $$ values
  ('Batata frita média', 72, '100g', 'normalizado', ''),
  ('Combo casal', 12, 'combo', 'revisar', 'combos diferentes'),
  ('Milkshake 400 ml', 33, '100ml', 'normalizado', ''),
  ('Molho especial extra', 9, 'un', 'revisar', 'poucos pares'),
  ('Refrigerante lata 350 ml', 80, 'un', 'auto', ''),
  ('Sundae', 4, 'un', 'revisar', 'poucos pares'),
  ('X-Bacon artesanal', 61, 'un', 'auto', '')
$$, 'C04: comparables, unit and status of the drawn rows');
select is((select norm_price_cents::int from items where name = 'Batata frita média'), 497, 'C04: R$ 4,97 por 100 g (M1-03)');
select is_empty($$ select 1 from items where pair_status = 'revisar' and reviewed_at is null and not skipped $$,
  'C04: the three items to review were reviewed on 28/out, so Calcular raio-X is open');

-- C05, P01.
select is((select count(*)::int from items where parity_cents is not null), 24, 'C05: 24 itens analisados');
select is((select count(*)::int from items where reading = 'pode_subir'), 7, 'C05: 7 abaixo da paridade');
select is((select count(*)::int from items where reading = 'nao_mexer'), 5, 'C05: 5 acima da paridade');
select results_eq($$ select name, own_cents::int, parity_cents::int, round(gap_pct * 100)::int, reading::text from items
  where name in ('Refrigerante lata 350 ml', 'Batata frita média', 'Milkshake 400 ml', 'Smash duplo', 'X-Bacon artesanal', 'Combo casal')
  order by gap_pct $$,
  $$ values
  ('Refrigerante lata 350 ml', 500, 650, -23, 'pode_subir'),
  ('Batata frita média', 1490, 1840, -19, 'pode_subir'),
  ('Milkshake 400 ml', 1690, 1990, -15, 'pode_subir'),
  ('Smash duplo', 2990, 3050, -2, 'na_media'),
  ('Combo casal', 7990, 6990, 14, 'nao_mexer'),
  ('X-Bacon artesanal', 3690, 3150, 17, 'nao_mexer')
$$, 'C05, P01: own price, parity, gap and reading of the drawn rows, to the centavo');
select is((select count(*)::int from items where pareto_cum_share < 0.8 or pareto_rank = (
           select min(pareto_rank) from items where pareto_cum_share >= 0.8)), 6, 'C05: 6 de 24 itens somam 80% da perda');
select results_eq($$ select name, round(pareto_cum_share * 100)::int from items where pareto_rank <= 6 order by pareto_rank $$,
  $$ values ('Batata frita média', 31), ('Refrigerante lata 350 ml', 53), ('Milkshake 400 ml', 67), ('Água 500 ml', 75),
            ('Sundae', 78), ('Molho especial extra', 80) $$, 'C05: Pareto rows and cumulative shares as drawn');
select results_eq($$ select name from items where reading = 'pode_subir' order by loss_cents desc limit 3 $$,
  $$ values ('Batata frita média'), ('Refrigerante lata 350 ml'), ('Milkshake 400 ml') $$, 'P01, M1-09: the three prices to raise');
select is((select sum(loss_cents)::bigint from items where loss_cents > 0), 70000::bigint, 'M1-08: R$ 700,00 of weekly loss in total');
select is((select percentile_cont(0.5) within group (order by m.price_cents)::int from public.xray_pair p
           join public.public_menu_item m on m.id = p.public_menu_item_id
           where p.accepted and p.xray_item_id = (select id from items where name = 'Combo casal')), 6990,
  'M1-05: parity of Combo casal is the median of the 7 pairs the founder accepted');
-- M1-05 in SQL for one unit item: the median of the accepted comparable prices (an even count: the two middle ones).
select is((select percentile_cont(0.5) within group (order by m.price_cents)::int from public.xray_pair p
           join public.public_menu_item m on m.id = p.public_menu_item_id
           where p.accepted and p.xray_item_id = (select id from items where name = 'Refrigerante lata 350 ml')), 650,
  'M1-05: parity of Refrigerante lata is the median of its 80 accepted pairs');

-- C06.
select results_eq($$ select step, minutes from public.time_log where xray_id = (select id from x) order by step $$,
  $$ values ('entrega', 18), ('pareamento', 60), ('vizinhanca', 30) $$, 'C06: Horas 0,3, 1,0 and 0,5');
select ok((select is_synthetic from public.account where code = 'G-01'), 'P01: synthetic account, the PDF carries SINTÉTICO');

select * from finish();
rollback;
