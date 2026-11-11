-- B01 positions per run (20261230000002): category position (M1-10 per category), product position, menu score (M1-12 v3,
-- "% de itens alinhados", Marlon 07/nov) and the history loaders. All stores, items and prices are SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

create function pg_temp.id(tag text) returns uuid language sql immutable as $$ select md5('pos:' || tag)::uuid $$;
create function pg_temp.item(store text, tag text, name text, price bigint) returns uuid language sql as $$
  insert into public.public_menu_item (id, public_store_id, external_item_id, name, price_cents)
  values (pg_temp.id(store || tag), pg_temp.id(store), tag, name, price) returning id
$$;

update public.rule_param set value = 1 where key = 'm1.rank_min_items';
update public.rule_param set value = 1 where key = 'm1.score_min_items';
insert into public.public_store (id, channel, external_id, name)
select pg_temp.id(s), 'ifood', 'pos-' || s, 'Loja ' || s from unnest(array['T', 'N1', 'N2', 'N3']) s;
insert into public.xray (id, target_store_id, status, collected_at) values (pg_temp.id('x'), pg_temp.id('T'), 'ready', '2026-11-07 10:00-03');
insert into public.xray_store (xray_id, public_store_id, distance_m, included)
select pg_temp.id('x'), pg_temp.id(s), 100, true from unnest(array['N1', 'N2', 'N3']) s;

select pg_temp.item('T', 'b', 'X-Burger', 2000), pg_temp.item('T', 'c', 'Refri lata', 600), pg_temp.item('T', 'f', 'Fritas', 1000);
select pg_temp.item(s, 'b', 'X-Burger', p), pg_temp.item(s, 'c', 'Refri lata', 600), pg_temp.item(s, 'f', 'Fritas', 800)
  from (values ('N1', 2500), ('N2', 2600), ('N3', 2700)) v (s, p);

insert into public.xray_item (id, xray_id, public_menu_item_id, norm_unit, norm_price_cents, parity_cents, gap_pct, reading,
                              pair_status, item_category) values
  (pg_temp.id('ib'), pg_temp.id('x'), pg_temp.id('Tb'), 'un', 2000, 2600, -0.2308, 'pode_subir', 'auto', 'lanches'),
  (pg_temp.id('ic'), pg_temp.id('x'), pg_temp.id('Tc'), 'un', 600, 600, 0, 'na_media', 'auto', 'bebidas'),
  (pg_temp.id('if'), pg_temp.id('x'), pg_temp.id('Tf'), 'un', 1000, 800, 0.25, 'nao_mexer', 'auto', 'porcoes');
insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted)
select pg_temp.id('i' || t), pg_temp.id(s || t), 1, true
  from unnest(array['N1', 'N2', 'N3']) s cross join unnest(array['b', 'c', 'f']) t;

select app.snapshot_xray(pg_temp.id('x'));

-- Product position ------------------------------------------------------------------------------------------------------
select results_eq($$ select percentile, rank, stores from public.xray_item_position where xray_item_id = pg_temp.id('ib') $$,
  $$ values (0.00::numeric(5,2), 1, 4) $$, 'product position: cheapest of the stores selling it');
select results_eq($$ select percentile, rank, stores from public.xray_item_position where xray_item_id = pg_temp.id('if') $$,
  $$ values (100.00::numeric(5,2), 4, 4) $$, 'product position: dearest');
select results_eq($$ select percentile, rank from public.xray_item_position where xray_item_id = pg_temp.id('ic') $$,
  $$ values (50.00::numeric(5,2), 1) $$, 'product position: same price as every store is the middle');

-- Category position -----------------------------------------------------------------------------------------------------
select results_eq($$ select rank, stores_ranked, price_index from public.xray_category_rank
                     where xray_id = pg_temp.id('x') and item_category = 'lanches' and is_target $$,
  $$ values (1, 4, 0.7692::numeric(7,4)) $$, 'M1-10 per category: lanches, the target is the cheapest');
select results_eq($$ select rank, stores_ranked from public.xray_category_rank
                     where xray_id = pg_temp.id('x') and item_category = 'porcoes' and is_target $$,
  $$ values (4, 4) $$, 'M1-10 per category: porções, the target is the dearest');
select is((select rank from public.xray_store_rank where xray_id = pg_temp.id('x') and is_target), 1, 'M1-10 store position as before (all medians at parity tie at 1)');

-- Menu score (M1-12 v3, "% de itens alinhados") ----------------------------------------------------------------------
select results_eq($$ select score, items, in_band, below, risk, price_gap_per_sale_cents
                      from public.xray_menu_score where xray_id = pg_temp.id('x') and scope = 'menu' $$,
  $$ values (33, 3, 1, 1, 1, 600::bigint) $$,
  'M1-12 v3: 100 x na_media items / items with a reading (1 of 3); below and above counted apart');
select results_eq($$ select scope, score from public.xray_menu_score where xray_id = pg_temp.id('x') and scope <> 'menu' order by scope $$,
  $$ values ('bebidas', 100), ('lanches', 0), ('porcoes', 0) $$,
  'M1-12 v3 per category: an item below or above the band is not aligned');
select is((select score_version from public.xray_menu_score where xray_id = pg_temp.id('x') and scope = 'menu'), 'm1-12.v4',
  'M1-12: each value keeps the version of its formula');
select results_eq($$ select captured_cents, parity_cents from public.xray_item_position where xray_item_id in (pg_temp.id('ib'), pg_temp.id('if')) order by captured_cents desc $$,
  $$ values (2000::bigint, 2600::bigint), (800::bigint, 800::bigint) $$,
  'M1-12: pode_subir captures its own price, any other reading its parity');

-- Never rewritten -------------------------------------------------------------------------------------------------------
update public.xray_item set parity_cents = 2000, gap_pct = 0 where id = pg_temp.id('ib');
select app.snapshot_xray(pg_temp.id('x'));
select is((select score from public.xray_menu_score where xray_id = pg_temp.id('x') and scope = 'menu'), 33,
  'a second snapshot keeps the first values');
select throws_ok($$ update public.xray_menu_score set score = 1 $$, '23001', null, 'scores are never updated');

-- Weekly units do not weigh the share of items -------------------------------------------------------------------------
delete from public.xray_menu_score where xray_id = pg_temp.id('x');
delete from public.xray_item_position where xray_id = pg_temp.id('x');
update public.xray_item set parity_cents = 2600, gap_pct = -0.2308, weekly_units = 3 where id = pg_temp.id('ib');
select app.positions_xray(pg_temp.id('x'));
select is((select score from public.xray_menu_score where xray_id = pg_temp.id('x') and scope = 'menu'), 33,
  'M1-12 v3 counts items: weekly units do not change the share');
select is((select price_gap_per_sale_cents from public.xray_menu_score where xray_id = pg_temp.id('x') and scope = 'menu'), 600::bigint,
  'the price gap is per sale, not weighted');

-- Loaders ---------------------------------------------------------------------------------------------------------------
insert into public.account (id, name, code, plan_id, is_synthetic)
  values (pg_temp.id('acc'), 'Conta pos', 'POS-1', (select id from public.plan where code = 'lucro'), true);
insert into public.xray_monitor (id, account_id, target_store_id, target_kind, every_days)
  values (pg_temp.id('mon'), pg_temp.id('acc'), pg_temp.id('T'), 'competitor', 7);
insert into public.xray (id, account_id, target_store_id, status, collected_at, monitor_id, created_at)
  values (pg_temp.id('old'), pg_temp.id('acc'), pg_temp.id('T'), 'ready', '2026-10-31 10:00-03', pg_temp.id('mon'), '2026-10-31 10:00-03');
update public.xray set account_id = pg_temp.id('acc'), monitor_id = pg_temp.id('mon') where id = pg_temp.id('x');

select is((public.monitor_positions(pg_temp.id('x')) -> 'score' ->> 'score')::numeric, 33::numeric, 'P23: the score with its components');
select is(jsonb_array_length(public.monitor_positions(pg_temp.id('x')) -> 'by_category'), 3, 'P23: score and position per category');
select is(public.monitor_history(pg_temp.id('mon')) ->> 'series_from', pg_temp.id('x')::text,
  'P24: the history starts at the first run with values');
select is(public.monitor_history(pg_temp.id('mon')) -> 'runs' -> 0 -> 'score', 'null'::jsonb, 'a run from before has no score');
select is((public.monitor_history(pg_temp.id('mon')) -> 'runs' -> 1 ->> 'score')::numeric, 33::numeric, 'P24: score per run');
select is((public.monitor_item_history(pg_temp.id('mon'), pg_temp.id('Tf')) -> 1 ->> 'percentile')::numeric, 100::numeric,
  'P24: percentile of the chosen item per run');


-- Change against the previous run, over the items scored in both ---------------------------------------------------------
insert into public.xray (id, account_id, target_store_id, status, collected_at, monitor_id, created_at)
  values (pg_temp.id('x2'), pg_temp.id('acc'), pg_temp.id('T'), 'ready', '2026-11-14 10:00-03', pg_temp.id('mon'), now() + interval '1 day');
insert into public.xray_item (id, xray_id, public_menu_item_id, norm_unit, norm_price_cents, parity_cents, gap_pct, reading, pair_status, item_category)
select md5(i.id::text || 'x2')::uuid, pg_temp.id('x2'), i.public_menu_item_id, i.norm_unit, i.norm_price_cents,
       case when i.id = pg_temp.id('ib') then 2000 else i.parity_cents end,
       case when i.id = pg_temp.id('ib') then 0 else i.gap_pct end,
       case when i.id = pg_temp.id('ib') then 'na_media'::public.xray_reading else i.reading end, i.pair_status, i.item_category
  from public.xray_item i where i.xray_id = pg_temp.id('x');
insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted)
select md5(p.xray_item_id::text || 'x2')::uuid, p.public_menu_item_id, 1, true
  from public.xray_pair p join public.xray_item i on i.id = p.xray_item_id where i.xray_id = pg_temp.id('x');
select app.positions_xray(pg_temp.id('x2'));
select results_eq($$ select score, previous_xray_id, delta, delta_items from public.xray_menu_score where xray_id = pg_temp.id('x2') and scope = 'menu' $$,
  $$ values (67, pg_temp.id('x'), 34, 3) $$, 'M1-12: the change covers the items scored in both runs');
update public.rule_param set value = 5 where key = 'm1.score_min_items';
delete from public.xray_menu_score where xray_id = pg_temp.id('x2');
select app.positions_xray(pg_temp.id('x2'));
select results_eq($$ select score, items from public.xray_menu_score where xray_id = pg_temp.id('x2') and scope = 'lanches' $$,
  $$ values (null::int, 1) $$, 'M1-12: a category under m1.score_min_items has no score, only its count');
select is((select score from public.xray_menu_score where xray_id = pg_temp.id('x2') and scope = 'menu'), 67,
  'the menu score has no minimum');
-- A run scored by an older formula shows no score: one line never mixes formulas -----------------------------------------
delete from public.xray_menu_score where xray_id = pg_temp.id('x');
insert into public.xray_menu_score (xray_id, scope, score, score_version, items, in_band, below, risk, price_gap_per_sale_cents)
  values (pg_temp.id('x'), 'menu', 85, 'm1-12.v2', 3, 1, 1, 1, 600);
select is(public.monitor_positions(pg_temp.id('x')) -> 'score', 'null'::jsonb, 'P23: a score of an older formula is not shown');

-- M1-12 v4 (D83): range dishes count with the exact items; combos stay out --------------------------------------------
insert into public.xray (id, target_store_id, status, collected_at) values (pg_temp.id('x4'), pg_temp.id('T'), 'ready', '2026-11-08 10:00-03');
insert into public.xray_item (id, xray_id, public_menu_item_id, norm_unit, norm_price_cents, pair_status, comparison_tier,
                              range_position, combo_solo_cents, item_category) values
  (pg_temp.id('r1'), pg_temp.id('x4'), pg_temp.id('Tb'), 'un', 2000, 'auto', 'faixa', 'dentro', null, 'lanches'),
  (pg_temp.id('r2'), pg_temp.id('x4'), pg_temp.id('Tf'), 'un', 1000, 'auto', 'faixa', 'acima', null, 'lanches'),
  (pg_temp.id('r3'), pg_temp.id('x4'), pg_temp.id('Tc'), 'un', 600, 'auto', 'faixa', 'abaixo', 9000, 'porcoes');
select app.menu_score_m1_12(pg_temp.id('x4'));
select results_eq($$ select score, items, in_band, below, risk from public.xray_menu_score where xray_id = pg_temp.id('x4') and scope = 'menu' $$,
  $$ values (50, 2, 1, 0, 1) $$, 'M1-12 v4: a dish inside its range is aligned, one above is not, a combo is left out');
select is((select score_version from public.xray_menu_score where xray_id = pg_temp.id('x4') and scope = 'menu'), 'm1-12.v4',
  'M1-12 v4: the current version');

select * from finish();
rollback;
