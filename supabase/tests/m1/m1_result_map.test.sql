-- P23 radius map (Marlon, 08/nov): monitor_map gives the run's compared stores as km offsets from the target, with no
-- names; stores outside the run's capture slots and stores without coordinates stay out. All stores are SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

create function pg_temp.id(tag text) returns uuid language sql immutable as $$ select md5('map:' || tag)::uuid $$;

insert into public.public_store (id, channel, external_id, name, lat, lng) values
  (pg_temp.id('T'), 'ifood', 'map-T', 'Loja Sintética T', -23.500000, -46.600000),
  (pg_temp.id('N'), 'ifood', 'map-N', 'Loja Sintética N', -23.491007, -46.600000),
  (pg_temp.id('E'), 'ifood', 'map-E', 'Loja Sintética E', -23.500000, -46.590194),
  (pg_temp.id('O'), 'ifood', 'map-O', 'Loja Sintética fora', -23.510000, -46.610000),
  (pg_temp.id('Z'), 'ifood', 'map-Z', 'Loja Sintética sem lugar', null, null);
insert into public.xray (id, account_id, target_store_id, target_kind, status, radius_km)
select pg_temp.id('x'), a.id, pg_temp.id('T'), 'own', 'ready', 3 from public.account a where a.is_synthetic limit 1;
insert into public.xray_store (xray_id, public_store_id, distance_m, included, capture_slot) values
  (pg_temp.id('x'), pg_temp.id('N'), 1000, true, true),
  (pg_temp.id('x'), pg_temp.id('E'), 1000, true, true),
  (pg_temp.id('x'), pg_temp.id('O'), 1400, true, false),
  (pg_temp.id('x'), pg_temp.id('Z'), 900, true, true);

select is((public.monitor_map(pg_temp.id('x')) ->> 'radius_km')::int, 3, 'the run''s radius');
select is(jsonb_array_length(public.monitor_map(pg_temp.id('x')) -> 'stores'), 2,
  'only the stores the run read, with coordinates');
select ok(exists (select 1 from jsonb_array_elements(public.monitor_map(pg_temp.id('x')) -> 'stores') s
                   where (s ->> 'x_km')::numeric = 0 and (s ->> 'y_km')::numeric = 1),
  'a store 1 km north');
select ok(exists (select 1 from jsonb_array_elements(public.monitor_map(pg_temp.id('x')) -> 'stores') s
                   where (s ->> 'x_km')::numeric = 1 and (s ->> 'y_km')::numeric = 0),
  'a store 1 km east');
select ok(public.monitor_map(pg_temp.id('x'))::text !~ 'Sintética', 'no store names');

update public.public_store set lat = null where id = pg_temp.id('T');
select is(public.monitor_map(pg_temp.id('x')), null, 'no map when the target has no coordinates');

select * from finish();
rollback;
