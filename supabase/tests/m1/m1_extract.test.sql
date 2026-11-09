-- M1 extraction copies (D47c, docs/extract-api.md): append-only copies, app.apply_extract_copy, the queue.
-- All stores and prices here are SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(47);

create function pg_temp.copy(p_run uuid, p_ext text, p_at timestamptz, p_payload jsonb) returns uuid
language plpgsql as $$
declare
  h text := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  new_id uuid;
begin
  insert into public.extract_content (content_hash, payload) values (h, p_payload) on conflict do nothing;
  insert into public.extract_copy (run_id, channel, store_external_id, collected_at, content_hash)
  values (p_run, 'ifood', p_ext, p_at, h) returning id into new_id;
  return new_id;
end $$;
create function pg_temp.run(p_kind public.extract_kind) returns uuid language sql as $$
  insert into public.extract_run (kind, source, status) values (p_kind, 'scraper', 'done') returning id
$$;

-- Append-only ---------------------------------------------------------------------------------------------
select pg_temp.copy(pg_temp.run('capture'), 'ext-1', '2026-10-01 10:00-03',
  '{"kind": "capture", "store": {"external_id": "ext-1", "url": "https://exemplo.test/1", "name": "Loja 1", "category": "Lanches",
    "lat": -10, "lng": -40, "rating": 4.5, "rating_count": 10, "slug": "a/b", "main_category_code": "LAN",
    "super_categories": ["RESTAURANT"], "address": "Rua Sintética, 1", "area": "Bairro"},
    "items": [{"external_item_id": "i1", "name": "Item 1", "price_cents": 1000, "taxonomy_level2": "PASTEIS", "category": "Mais",
               "original_price_cents": 1200, "unit": "g", "unit_qty": 100, "description": "descr"},
              {"external_item_id": "i2", "name": "Item 2", "price_cents": 0, "minimum_price_cents": 1900}]}');
create temp table c1 as select id from public.extract_copy where store_external_id = 'ext-1';
select throws_ok($$ update public.extract_copy set store_external_id = 'z' $$, '23001', null, 'D47c: a copy is never updated');
select throws_ok($$ delete from public.extract_copy $$, '23001', null, 'D47c: a copy is never deleted');
select throws_ok($$ delete from public.extract_content $$, '23001', null, 'D47c: content is never deleted');

-- First application ---------------------------------------------------------------------------------------
select lives_ok($$ select app.apply_extract_copy((select id from c1)) $$, 'D47c: a copy applies');
create temp table s1 as select id from public.public_store where external_id = 'ext-1';
select results_eq($$ select name, slug, main_category_code, super_categories, rating, rating_count, area from public.public_store where external_id = 'ext-1' $$,
  $$ values ('Loja 1', 'a/b', 'LAN', array['RESTAURANT'], 4.50::numeric(3,2), 10, 'Bairro') $$, 'D47c: store fields from the copy');
select is((select address from public.public_store_private where public_store_id = (select id from s1)), 'Rua Sintética, 1',
  'D47c: the street address goes to public_store_private');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'public_store' and column_name = 'address'), 0,
  'D47c: public_store has no address column');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name in ('public_store_snapshot', 'public_menu_item_snapshot') and column_name = 'address'), 0,
  'D47c: snapshots have no address column');
select is((select last_seen_open_at from public.public_store where external_id = 'ext-1'), null,
  'M1-02: last_seen_open_at is not set on write');
select results_eq($$ select category, taxonomy_level2, original_price_cents, unit::text, unit_qty, price_cents, comparison_price_cents from public.public_menu_item
                      where external_item_id = 'i1' and public_store_id = (select id from s1) $$,
  $$ values ('Mais', 'PASTEIS', 1200::bigint, 'g', 100.00::numeric(10,2), 1000::bigint, 1000::bigint) $$, 'M1-05: parity price is the current one; the full price is only stored');
select is((select comparison_price_cents from public.public_menu_item where external_item_id = 'i2' and public_store_id = (select id from s1)), 1900::bigint,
  'M1-05: price 0 with a minimum price uses the minimum');

-- Founder and manual fields survive, a missing field stays ------------------------------------------------
update public.public_store set is_national_chain = true where id = (select id from s1);
select pg_temp.copy(pg_temp.run('discover'), 'ext-1', '2026-10-08 10:00-03',
  '{"kind": "discover_store", "store": {"external_id": "ext-1", "url": "https://exemplo.test/1b", "name": "Loja 1 nova", "is_open": true}, "distance_km": 1.5}');
create temp table c2 as select c.id from public.extract_copy c join public.extract_run r on r.id = c.run_id where c.store_external_id = 'ext-1' and r.kind = 'discover';
select app.apply_extract_copy((select id from c2));
select results_eq($$ select name, url, is_national_chain, lat::float8, category from public.public_store where external_id = 'ext-1' $$,
  $$ values ('Loja 1 nova', 'https://exemplo.test/1b', true, -10::float8, 'Lanches') $$, 'D47c: no manual field overwritten, no field nulled');
select is((select last_seen_open_at from public.public_store where external_id = 'ext-1'), '2026-10-08 10:00-03'::timestamptz,
  'M1-02: last_seen_open_at from the explicit open signal');
select results_eq($$ select count(*)::int from public.public_menu_item where public_store_id = (select id from s1) and removed_at is not null $$,
  array[0], 'D47c: a discovery copy removes no item');

-- Re-running over an old copy does not bring old values back ------------------------------------------------
select app.apply_extract_copy((select id from c1));
select is((select name from public.public_store where external_id = 'ext-1'), 'Loja 1 nova', 'D47c: re-applying an old copy keeps the newer value');
select is((select last_seen_open_at from public.public_store where external_id = 'ext-1'), '2026-10-08 10:00-03'::timestamptz, 'M1-02: an old copy does not move the open signal');

-- A newer capture removes what it no longer lists -------------------------------------------------------------
select pg_temp.copy(pg_temp.run('capture'), 'ext-1', '2026-10-15 10:00-03',
  '{"kind": "capture", "store": {"external_id": "ext-1", "url": "https://exemplo.test/1b", "address": "Rua Sintética, 2"},
    "items": [{"external_item_id": "i1", "name": "Item 1", "price_cents": 1100}]}');
create temp table c3 as select c.id from public.extract_copy c where c.store_external_id = 'ext-1' and c.collected_at = '2026-10-15 10:00-03';
select app.apply_extract_copy((select id from c3));
select is((select removed_at from public.public_menu_item where external_item_id = 'i2' and public_store_id = (select id from s1)), '2026-10-15 10:00-03'::timestamptz,
  'D47c: an item missing from a newer capture is marked removed');
select results_eq($$ select price_cents, taxonomy_level2, unit::text from public.public_menu_item where external_item_id = 'i1' and public_store_id = (select id from s1) $$,
  $$ values (1100::bigint, 'PASTEIS', 'g') $$, 'D47c: the capture updates the price and nulls nothing it lacks');
select is((select address from public.public_store_private where public_store_id = (select id from s1)), 'Rua Sintética, 2', 'D47c: the newer address replaces the old');
select app.apply_extract_copy((select id from c1));
select is((select removed_at from public.public_menu_item where external_item_id = 'i2' and public_store_id = (select id from s1)), '2026-10-15 10:00-03'::timestamptz,
  'D47c: re-applying the old capture does not bring a removed item back');
select is((select price_cents from public.public_menu_item where external_item_id = 'i1' and public_store_id = (select id from s1)), 1100::bigint,
  'D47c: re-applying the old capture does not bring the old price back');
select is((select address from public.public_store_private where public_store_id = (select id from s1)), 'Rua Sintética, 2', 'D47c: nor the old address');
select pg_temp.copy(pg_temp.run('capture'), 'ext-1', '2026-10-22 10:00-03',
  '{"kind": "capture", "store": {"external_id": "ext-1", "url": "https://exemplo.test/1b"}, "items": [{"external_item_id": "i2", "name": "Item 2", "price_cents": 700}]}');
select app.apply_extract_copy((select c.id from public.extract_copy c where c.store_external_id = 'ext-1' and c.collected_at = '2026-10-22 10:00-03'));
select is((select removed_at from public.public_menu_item where external_item_id = 'i2' and public_store_id = (select id from s1)), null,
  'D47c: an item that comes back loses removed_at');

-- B01: a capture carries the complete menu, so no promotion or minimum in it means none now. A discovery does not ---
create function pg_temp.b01_prices(item text) returns table (o bigint, m bigint, c bigint) language sql as $$
  select i.original_price_cents, i.minimum_price_cents, i.comparison_price_cents
    from public.public_menu_item i join public.public_store s on s.id = i.public_store_id
   where s.external_id = 'ext-b01' and i.external_item_id = item
$$;
select app.apply_extract_copy(pg_temp.copy(pg_temp.run('capture'), 'ext-b01', '2026-10-01 10:00-03',
  '{"kind": "capture", "store": {"external_id": "ext-b01", "name": "Loja B01", "category": "Lanches"},
    "items": [{"external_item_id": "promo", "name": "Promo", "price_cents": 1000, "original_price_cents": 1200, "description": "descr",
               "category": "Mais", "taxonomy_level1": "T1", "taxonomy_level2": "T2", "unit": "g", "unit_qty": 100},
              {"external_item_id": "monte", "name": "Monte", "price_cents": 0, "minimum_price_cents": 1900}]}'));
select results_eq($$ select * from pg_temp.b01_prices('monte') $$, $$ values (null::bigint, 1900::bigint, 1900::bigint) $$,
  'B01: the first capture stores the minimum, which enters parity at price 0');

select app.apply_extract_copy(pg_temp.copy(pg_temp.run('discover'), 'ext-b01', '2026-10-08 10:00-03',
  '{"kind": "discover_store", "store": {"external_id": "ext-b01"},
    "items": [{"external_item_id": "promo", "name": "Promo", "price_cents": 1000}, {"external_item_id": "monte", "name": "Monte", "price_cents": 0}]}'));
select results_eq($$ select * from pg_temp.b01_prices('promo') $$, $$ values (1200::bigint, null::bigint, 1000::bigint) $$,
  'B01: a discovery copy lacking the full price leaves it');
select results_eq($$ select * from pg_temp.b01_prices('monte') $$, $$ values (null::bigint, 1900::bigint, 1900::bigint) $$,
  'B01: a discovery copy lacking the minimum leaves it');

select app.apply_extract_copy(pg_temp.copy(pg_temp.run('capture'), 'ext-b01', '2026-10-15 10:00-03',
  '{"kind": "capture", "store": {"external_id": "ext-b01"},
    "items": [{"external_item_id": "promo", "name": "Promo", "price_cents": 1100}, {"external_item_id": "monte", "name": "Monte", "price_cents": 0}]}'));
select results_eq($$ select * from pg_temp.b01_prices('promo') $$, $$ values (null::bigint, null::bigint, 1100::bigint) $$,
  'B01: a capture without the full price means the promotion ended');
select results_eq($$ select * from pg_temp.b01_prices('monte') $$, $$ values (null::bigint, null::bigint, 0::bigint) $$,
  'B01, M1-05: a capture without the minimum clears it, so a stale minimum cannot enter parity at price 0');
select results_eq($$ select i.description, i.category, i.taxonomy_level1, i.taxonomy_level2, i.unit::text, i.unit_qty, s.name, s.category
                      from public.public_menu_item i join public.public_store s on s.id = i.public_store_id
                     where s.external_id = 'ext-b01' and i.external_item_id = 'promo' $$,
  $$ values ('descr', 'Mais', 'T1', 'T2', 'g', 100.00::numeric(10,2), 'Loja B01', 'Lanches') $$,
  'B01: the same capture nulls no other item field and no store field');

select app.apply_extract_copy(c.id) from public.extract_copy c
 where c.store_external_id = 'ext-b01' and c.collected_at = '2026-10-01 10:00-03';
select results_eq($$ select * from pg_temp.b01_prices('monte') $$, $$ values (null::bigint, null::bigint, 0::bigint) $$,
  'B01: re-applying the old capture does not bring the old minimum back');

select app.apply_extract_copy(pg_temp.copy(pg_temp.run('capture'), 'ext-b01', '2026-10-22 10:00-03',
  '{"kind": "capture", "store": {"external_id": "ext-b01"},
    "items": [{"external_item_id": "promo", "name": "Promo", "price_cents": 800, "original_price_cents": 1100}, {"external_item_id": "monte", "name": "Monte", "price_cents": 0, "minimum_price_cents": 2100}]}'));
select results_eq($$ select * from pg_temp.b01_prices('promo') $$, $$ values (1100::bigint, null::bigint, 800::bigint) $$,
  'B01: a later capture with a promotion stores it again');
select results_eq($$ select * from pg_temp.b01_prices('monte') $$, $$ values (null::bigint, 2100::bigint, 2100::bigint) $$,
  'B01: a later capture with a minimum stores it again');

-- Complements: kept from a capture, left by a discovery copy, cleared by a capture without them --------------------
create function pg_temp.item_choices() returns jsonb language sql as $$
  select i.choices from public.public_menu_item i join public.public_store s on s.id = i.public_store_id
   where s.external_id = 'ext-choices' and i.external_item_id = 'monte'
$$;
select app.apply_extract_copy(pg_temp.copy(pg_temp.run('capture'), 'ext-choices', '2026-10-01 10:00-03',
  '{"kind": "capture", "store": {"external_id": "ext-choices"},
    "items": [{"external_item_id": "monte", "name": "Monte", "price_cents": 0, "minimum_price_cents": 1900,
               "choices": [{"name": "Proteína", "min": 1, "max": 1, "options": [{"name": "Frango", "price_cents": 0}]}]}]}'));
select is(pg_temp.item_choices() -> 0 ->> 'name', 'Proteína', 'Complements: a capture stores the groups');
select app.apply_extract_copy(pg_temp.copy(pg_temp.run('discover'), 'ext-choices', '2026-10-08 10:00-03',
  '{"kind": "discover_store", "store": {"external_id": "ext-choices"},
    "items": [{"external_item_id": "monte", "name": "Monte", "price_cents": 0}]}'));
select is(pg_temp.item_choices() -> 0 ->> 'name', 'Proteína', 'Complements: a discovery copy without them leaves them');
select app.apply_extract_copy(pg_temp.copy(pg_temp.run('capture'), 'ext-choices', '2026-10-15 10:00-03',
  '{"kind": "capture", "store": {"external_id": "ext-choices"},
    "items": [{"external_item_id": "monte", "name": "Monte", "price_cents": 1900}]}'));
select is(pg_temp.item_choices(), null::jsonb, 'Complements: a capture without them clears them');

-- snapshot_xray and the view -----------------------------------------------------------------------------------
insert into public.xray (id, target_store_id, status, collected_at) values ('aaaaaaaa-0000-4000-8000-000000000001', (select id from s1), 'collecting', now());
select app.snapshot_xray('aaaaaaaa-0000-4000-8000-000000000001');
select results_eq($$ select i.external_item_id, sn.price_cents from public.public_menu_item_snapshot sn join public.public_menu_item i on i.id = sn.public_menu_item_id
                      where sn.xray_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  $$ values ('i2', 700::bigint) $$, 'D47c: the snapshot ignores removed items');
select is((select count(*)::int from information_schema.column_privileges where table_name = 'public_store_snapshot' and column_name = 'address'), 0,
  'D47c: the snapshot has no address');

-- The queue ------------------------------------------------------------------------------------------------------
select ok(exists (select 1 from public.rule_param where key = 'm1.extract_every_days' and value = 7), '04 §1: param m1.extract_every_days = 7');
select results_eq($$ select env::text, default_raio_x, default_lucro, default_rede from public.feature_flag where key = 'm1.extracao' order by env::text desc $$,
  $$ values ('sandbox', true, true, true), ('production', false, false, false) $$, 'A05: m1.extracao on in sandbox, off in production');

-- Lead X-ray with a store that was never captured, one captured recently and one captured long ago.
insert into public.public_store (id, channel, external_id, url) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'ifood', 'ext-t', 'https://exemplo.test/t'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'ifood', 'ext-new', 'https://exemplo.test/new'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'ifood', 'ext-old', 'https://exemplo.test/old'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'ifood', 'ext-out', 'https://exemplo.test/out');
insert into public.xray (id, target_store_id, status, collected_at) values ('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'collecting', now());
insert into public.xray_store (xray_id, public_store_id, distance_m, included, exclusion_reason) values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 100, true, null),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003', 100, true, null),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000004', 100, false, 'manual');
select pg_temp.copy(pg_temp.run('capture'), 'ext-new', now() - interval '6 days', '{"kind": "capture", "store": {"external_id": "ext-new"}, "items": []}');
select pg_temp.copy(pg_temp.run('capture'), 'ext-old', now() - interval '8 days', '{"kind": "capture", "store": {"external_id": "ext-old"}, "items": []}');
delete from public.job where type = 'extract_capture';
select public.extract_queue_due('sandbox');
select results_eq($$ select payload ->> 'external_id' from public.job where type = 'extract_capture' and payload ->> 'external_id' like 'ext-%' and payload ->> 'external_id' <> 'ext-1' order by 1 $$,
  $$ values ('ext-old'), ('ext-t') $$, 'D47c: only stores in the set whose last capture is older than the param');
select is(public.extract_queue_due('sandbox'), 0, 'A07: a second run finds them active (dedupe_key)');
select is(public.extract_queue_due('production'), 0, 'A05: flag off in production queues nothing');
select is_empty($$ select 1 from public.job j join public.public_store s on s.id = (j.payload ->> 'public_store_id')::uuid
                    join public.xray x on x.target_store_id = s.id join public.account a on a.id = x.account_id
                   where j.type = 'extract_capture' and a.is_synthetic $$, 'G-SYN stores are never queued');

-- Functions are not callable by browser roles ------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.extract_claim_next(text, public.flag_env)', 'execute'), 'extract_claim_next: not for authenticated');
select ok(not has_function_privilege('anon', 'public.extract_record_result(uuid, text, timestamptz, jsonb)', 'execute'), 'extract_record_result: not for anon');
select ok(has_function_privilege('service_role', 'public.xray_discovery(uuid)', 'execute'), 'xray_discovery: service role');
select ok(not has_function_privilege('authenticated', 'app.apply_extract_copy(uuid)', 'execute'), 'apply_extract_copy: not for authenticated');

select * from finish();
rollback;
