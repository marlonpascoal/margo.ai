-- B01 owner journey screens (20261231000001): "Ver as lojas" per item, the competitor head-to-head and the one-time
-- print token of "Baixar PDF". All stores, items and prices are SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

create function pg_temp.id(tag text) returns uuid language sql immutable as $$ select md5('portal-print:' || tag)::uuid $$;
create function pg_temp.item(store text, tag text, name text, price bigint) returns uuid language sql as $$
  insert into public.public_menu_item (id, public_store_id, external_item_id, name, price_cents)
  values (pg_temp.id(store || tag), pg_temp.id(store), tag, name, price) returning id
$$;

update public.rule_param set value = 1 where key = 'm1.portal_show_store_names';
insert into public.public_store (id, channel, external_id, name)
select pg_temp.id(s), 'ifood', 'pp-' || s, 'Loja Sintética ' || s from unnest(array['T', 'N1', 'N2', 'C']) s;

-- An own monitoring (T) of Grupo Exemplo whose neighborhood holds the competitor C, and a competitor monitoring of C.
insert into public.xray_monitor (id, account_id, target_store_id, target_kind, every_days)
select pg_temp.id(t), a.id, pg_temp.id(s), k, 7 from public.account a,
  (values ('mo', 'T', 'own'), ('mc', 'C', 'competitor')) v (t, s, k) where a.code = 'G-02';
insert into public.xray (id, account_id, target_store_id, target_kind, status, collected_at, monitor_id)
select pg_temp.id(t), a.id, pg_temp.id(s), k, 'ready', '2026-11-02 10:00-03', pg_temp.id(m) from public.account a,
  (values ('xo', 'T', 'own', 'mo'), ('xc', 'C', 'competitor', 'mc')) v (t, s, k, m) where a.code = 'G-02';
insert into public.xray_store (xray_id, public_store_id, distance_m, included)
select pg_temp.id('xo'), pg_temp.id(s), 100, true from unnest(array['N1', 'N2', 'C']) s;

select pg_temp.item('T', 'b', 'X-Burger', 2000), pg_temp.item('T', 'r', 'Refri lata', 600);
select pg_temp.item(s, 'b', 'X-Burger', p), pg_temp.item(s, 'r', 'Refri lata', 650)
  from (values ('N1', 2600), ('N2', 2400), ('C', 2500)) v (s, p);

insert into public.xray_item (id, xray_id, public_menu_item_id, norm_unit, norm_price_cents, parity_cents, gap_pct, reading,
                              pair_status, item_category, skipped) values
  (pg_temp.id('ib'), pg_temp.id('xo'), pg_temp.id('Tb'), 'un', 2000, 2500, -0.2, 'pode_subir', 'auto', 'lanches', false),
  (pg_temp.id('ir'), pg_temp.id('xo'), pg_temp.id('Tr'), 'un', 600, null, null, null, 'revisar', 'bebidas', true);
insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted)
select pg_temp.id('ib'), pg_temp.id(s || 'b'), 1, true from unnest(array['N1', 'N2', 'C']) s;
insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted)
select pg_temp.id('ir'), pg_temp.id(s || 'r'), 0.7, false from unnest(array['N1', 'C']) s;

-- Ver as lojas ---------------------------------------------------------------------------------------------------------
select is(jsonb_array_length(public.monitor_result_stores(pg_temp.id('xo'))), 1,
  'P23 Ver as lojas: only analyzed items (a doubt left out of the result has no list)');
select is((public.monitor_result_stores(pg_temp.id('xo')) -> 0 -> 'stores')::text,
  '[{"name": "Loja Sintética N2", "price_cents": 2400}, {"name": "Loja Sintética C", "price_cents": 2500}, {"name": "Loja Sintética N1", "price_cents": 2600}]',
  'P23 Ver as lojas: accepted stores by name (Q7), cheapest first');
update public.rule_param set value = 0 where key = 'm1.portal_show_store_names';
update public.xray_store set capture_rank = 7 where xray_id = pg_temp.id('xo') and public_store_id = pg_temp.id('N2');
select is(public.monitor_result_stores(pg_temp.id('xo')) -> 0 -> 'stores' -> 0 ->> 'name', 'Loja vizinha 07',
  'P23 Ver as lojas: with m1.portal_show_store_names 0 a neighbor is "Loja vizinha NN"');
update public.rule_param set value = 1 where key = 'm1.portal_show_store_names';

-- Stage 2 exclusivo -----------------------------------------------------------------------------------------------------
select pg_temp.item('T', 'e', 'Prato Sintético da Casa', 4500), pg_temp.item('N1', 'e', 'Prato Sintético Parecido', 3900);
insert into public.xray_item (id, xray_id, public_menu_item_id, norm_unit, norm_price_cents, pair_status, pair_note, item_category, skipped)
values (pg_temp.id('ie'), pg_temp.id('xo'), pg_temp.id('Te'), 'un', 4500, 'exclusivo', 'exclusivo, sem comparação', 'pratos', false);
insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted) values (pg_temp.id('ie'), pg_temp.id('N1e'), 0.5, false);
select is((public.monitor_doubts(pg_temp.id('xo')) ->> 'only_yours')::int, 1, 'Stage 2: an exclusivo item is "só seu" even with unaccepted candidates');
select ok(not (public.monitor_doubts(pg_temp.id('xo')) -> 'items') @> format('[{"item_id": "%s"}]', pg_temp.id('ie'))::jsonb,
  'Stage 2: an exclusivo item is never a doubt');
select is((select jsonb_agg(e ->> 'name') from jsonb_array_elements(public.monitor_items(pg_temp.id('xo')) -> 'only_yours') e)::text,
  '["Prato Sintético da Casa"]', 'Stage 2: "Itens só seus" lists the exclusivo item');

-- Head-to-head ---------------------------------------------------------------------------------------------------------
select is(public.monitor_head_to_head(pg_temp.id('xo')), null, 'head-to-head is for a competitor run only');
select is(public.monitor_head_to_head(pg_temp.id('xc')) ->> 'own_store_name', 'Loja Sintética T',
  'head-to-head: from the own run whose neighborhood holds the competitor');
select is((public.monitor_head_to_head(pg_temp.id('xc')) -> 'items')::text,
  format('[{"name": "X-Burger", "group": "lanches", "item_id": "%s", "own_cents": 2000, "their_cents": 2500}]', pg_temp.id('ib')),
  'head-to-head: accepted items only, own price and the competitor''s');
delete from public.xray_store where xray_id = pg_temp.id('xo') and public_store_id = pg_temp.id('C');
select is(public.monitor_head_to_head(pg_temp.id('xc')), null, 'head-to-head hidden when no own neighborhood holds the competitor (draft §8)');

-- Print token ----------------------------------------------------------------------------------------------------------
insert into public.xray_print_token (xray_id, token_hash, expires_at) values
  (pg_temp.id('xo'), repeat('a', 64), now() + interval '5 minutes'),
  (pg_temp.id('xo'), repeat('b', 64), now() - interval '1 minute');
select ok(not public.xray_print_token_use(pg_temp.id('xc'), repeat('a', 64)), 'print token: good for its own run only');
select ok(public.xray_print_token_use(pg_temp.id('xo'), repeat('a', 64)) and not public.xray_print_token_use(pg_temp.id('xo'), repeat('a', 64)),
  'print token: good once');
select ok(not public.xray_print_token_use(pg_temp.id('xo'), repeat('b', 64)), 'print token: not after it expires');

select * from finish();
rollback;
