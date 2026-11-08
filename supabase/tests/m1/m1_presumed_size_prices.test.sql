-- Prices shown per the owner's unit honor the M1-04 default sizes (20261229000003): a neighbor's "lata" with no size in
-- its name was paired as 350 ml (xray_pair.size_presumed_ml), an owner's "Água, unidade" as 500 ml
-- (xray_item.size_presumed_ml). "Ver as lojas", the price strip and the head-to-head must not read the neighbor's whole
-- price as a price per ml (Marlon saw a R$ 2.800 lata, 08/nov). All stores, items and prices are SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

create function pg_temp.id(tag text) returns uuid language sql immutable as $$ select md5('presumed:' || tag)::uuid $$;

insert into public.public_store (id, channel, external_id, name)
select pg_temp.id(s), 'ifood', 'ps-' || s, 'Loja Sintética ' || s from unnest(array['T', 'N1', 'N2']) s;
insert into public.xray_monitor (id, account_id, target_store_id, target_kind, every_days)
select pg_temp.id('m'), a.id, pg_temp.id('T'), 'own', 7 from public.account a where a.is_synthetic limit 1;
insert into public.xray (id, account_id, target_store_id, target_kind, status, collected_at, monitor_id)
select pg_temp.id('x'), m.account_id, pg_temp.id('T'), 'own', 'ready', '2026-11-02 10:00-03', m.id
  from public.xray_monitor m where m.id = pg_temp.id('m');
insert into public.xray_store (xray_id, public_store_id, distance_m, included)
select pg_temp.id('x'), pg_temp.id(s), 100, true from unnest(array['N1', 'N2']) s;

insert into public.public_menu_item (id, public_store_id, external_item_id, name, price_cents, unit, unit_qty) values
  (pg_temp.id('Tc'), pg_temp.id('T'), 'c', 'Refri cola 350ml', 890, 'ml', 350),
  (pg_temp.id('N1c'), pg_temp.id('N1'), 'c', 'Refri cola lata', 800, 'un', null),
  (pg_temp.id('N2c'), pg_temp.id('N2'), 'c', 'Refri cola 350ml', 900, 'ml', 350),
  (pg_temp.id('Ta'), pg_temp.id('T'), 'a', 'Água mineral unidade', 550, 'un', null),
  (pg_temp.id('N1a'), pg_temp.id('N1'), 'a', 'Água mineral 500ml', 500, 'ml', 500),
  (pg_temp.id('N2a'), pg_temp.id('N2'), 'a', 'Água mineral 1,5 l', 900, 'ml', 1500);

insert into public.xray_item (id, xray_id, public_menu_item_id, norm_unit, norm_price_cents, parity_cents, gap_pct, reading,
                              pair_status, item_category, size_presumed_ml) values
  (pg_temp.id('ic'), pg_temp.id('x'), pg_temp.id('Tc'), '100ml', 254, 850, 0.047, 'na_media', 'auto', 'bebidas', null),
  (pg_temp.id('ia'), pg_temp.id('x'), pg_temp.id('Ta'), '100ml', 110, 400, 0.375, 'nao_mexer', 'auto', 'bebidas', 500);
insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted, size_presumed_ml) values
  (pg_temp.id('ic'), pg_temp.id('N1c'), 1, true, 350),
  (pg_temp.id('ic'), pg_temp.id('N2c'), 1, true, null),
  (pg_temp.id('ia'), pg_temp.id('N1a'), 1, true, null),
  (pg_temp.id('ia'), pg_temp.id('N2a'), 1, true, null);

select is(app.own_unit_price_m1_03(800, 'un', null, 350, 'ml', 350, null), 800::numeric,
  'M1-03: a neighbor lata presumed 350 ml, in the owner''s 350 ml, keeps its price');
select is(app.own_unit_price_m1_03(900, 'ml', 1500, null, 'un', null, 500), 300::numeric,
  'M1-03: an owner item presumed 500 ml takes 500 ml of a 1,5 l neighbor');
select is(app.own_unit_price_m1_03(2000, 'un', null, null, 'un', null, null), 2000::numeric,
  'M1-03: items without sizes compare whole, as before');

select is((select jsonb_agg((s ->> 'price_cents')::int order by (s ->> 'price_cents')::int)
             from jsonb_array_elements(public.monitor_result_stores(pg_temp.id('x'))) e, jsonb_array_elements(e -> 'stores') s
            where (e ->> 'item_id')::uuid = pg_temp.id('ic')),
  '[800, 900]'::jsonb, 'Ver as lojas: the presumed lata shows R$ 8,00, not R$ 2.800');
select is((select jsonb_agg((s ->> 'price_cents')::int order by (s ->> 'price_cents')::int)
             from jsonb_array_elements(public.monitor_result_stores(pg_temp.id('x'))) e, jsonb_array_elements(e -> 'stores') s
            where (e ->> 'item_id')::uuid = pg_temp.id('ia')),
  '[300, 500]'::jsonb, 'Ver as lojas: water per the owner''s presumed 500 ml');

select is((select jsonb_build_array((i ->> 'low_cents')::numeric, (i ->> 'high_cents')::numeric)
             from jsonb_array_elements(public.monitor_result(pg_temp.id('x')) -> 'items') i
            where (i ->> 'item_id')::uuid = pg_temp.id('ic')),
  '[800, 900]'::jsonb, 'price strip: low and high per the owner''s unit');
select ok((select bool_and((i ->> 'high_cents')::numeric < 100000)
             from jsonb_array_elements(public.monitor_result(pg_temp.id('x')) -> 'items') i),
  'price strip: no beverage above R$ 1.000');

select * from finish();
rollback;
