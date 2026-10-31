-- M1 history: dated snapshots per run, never rewritten; M1-10 ranking; xray.target_kind.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

select is((select target_kind from public.xray where id = '9aae2f75-4168-fde3-4570-d7bd0f4669d0'), 'own',
  'target_kind: Pantanos is a channel store of G-01, so the X-ray is of its own store');
select is((select count(*)::int from public.xray_store_rank where xray_id = '9aae2f75-4168-fde3-4570-d7bd0f4669d0' and is_target), 1,
  'M1-10: the calculated run ranks its target');
select ok((select bool_and(rank between 1 and stores_ranked) from public.xray_store_rank), 'M1-10: ranks within 1..N');
select is_empty($$ select tablename from pg_policies where tablename in
  ('public_store_snapshot', 'public_menu_item_snapshot', 'xray_store_rank') and cmd <> 'SELECT' $$,
  'A02: history tables are read only for staff');

-- A competitor: a public store that is no channel store of the account.
insert into public.public_store (id, channel, external_id, name) values
  ('00000000-0000-4000-8000-0000000000c1', 'ifood', '00000000-0000-4000-8000-0000000000e1', 'Outra loja');
insert into public.xray (id, account_id, target_store_id) values
  ('00000000-0000-4000-8000-0000000000a2', '7876ec36-6300-3834-5468-98cc88f67dcb', '00000000-0000-4000-8000-0000000000c1');
select is((select target_kind from public.xray where id = '00000000-0000-4000-8000-0000000000a2'), 'competitor',
  'target_kind: another store is a competitor');

-- B01 history: a second run on the same store keeps the first run's prices.
create temp table first_run as
  select public_menu_item_id, price_cents from public.public_menu_item_snapshot
   where xray_id = '9aae2f75-4168-fde3-4570-d7bd0f4669d0';
update public.public_menu_item set price_cents = price_cents + 500
 where public_store_id = 'ffffa5b5-8743-e8a8-7736-fa97c275e3b4';
insert into public.xray (id, account_id, target_store_id, collected_at) values
  ('00000000-0000-4000-8000-0000000000a3', '7876ec36-6300-3834-5468-98cc88f67dcb',
   'ffffa5b5-8743-e8a8-7736-fa97c275e3b4', '2026-11-28T10:00:00-03:00');
select app.snapshot_xray('00000000-0000-4000-8000-0000000000a3');
select app.snapshot_xray('9aae2f75-4168-fde3-4570-d7bd0f4669d0');
select set_eq($$ select public_menu_item_id, price_cents from public.public_menu_item_snapshot
                  where xray_id = '9aae2f75-4168-fde3-4570-d7bd0f4669d0' $$,
              $$ select * from first_run $$, 'B01 history: the first run keeps its prices after a second run');
select ok((select bool_and(s.price_cents = i.price_cents) from public.public_menu_item_snapshot s
             join public.public_menu_item i on i.id = s.public_menu_item_id
            where s.xray_id = '00000000-0000-4000-8000-0000000000a3'), 'B01 history: the second run has the new prices');
select is((select count(*)::int from public.public_menu_item_snapshot where xray_id = '00000000-0000-4000-8000-0000000000a3'), 24,
  'B01 history: the second run snapshots the target''s 24 items');
select throws_ok($$ update public.public_menu_item_snapshot set price_cents = 1 $$, '23001', null,
  'snapshots are never changed');
select throws_ok($$ update public.xray_store_rank set rank = 1 $$, '23001', null, 'rankings are never changed');
select ok((select count(*) = 2 from (select distinct xray_id from public.xray_store_rank
            where public_store_id = 'ffffa5b5-8743-e8a8-7736-fa97c275e3b4') t),
  'history: the store has a ranking in each calculated run');

select * from finish();
rollback;
