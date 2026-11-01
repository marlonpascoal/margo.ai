-- B01 M1-10 (Marlon, 31/out): a neighbor store is ranked only when at least m1.rank_min_items (param, 3) of
-- the target's items were compared with it; the target is always ranked when it has items. Rankings already
-- written are never rewritten.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

select is((select value from public.rule_param where key = 'm1.rank_min_items'), 3::numeric,
  'B01 M1-10: m1.rank_min_items is a param, 3');

-- The seed run of 28/out: every neighbor shares 7 or more items, so its ranking is unchanged (31 of 85).
select results_eq($$ select rank, stores_ranked from public.xray_store_rank
                     where xray_id = '9aae2f75-4168-fde3-4570-d7bd0f4669d0' and is_target $$,
  $$ values (31, 85) $$, 'B01 M1-10: the seed run still ranks Pantanos 31 of 85');

-- Copies of the seed run with only the first n analyzed items (by name) and their pairs.
create function pg_temp.copy_run(p_new uuid, p_items int) returns void language plpgsql as $$
declare it record; new_item uuid;
begin
  insert into public.xray (id, account_id, target_store_id, status, collected_at)
  select p_new, account_id, target_store_id, 'ready', now() from public.xray where id = '9aae2f75-4168-fde3-4570-d7bd0f4669d0';
  for it in select xi.* from public.xray_item xi join public.public_menu_item m on m.id = xi.public_menu_item_id
             where xi.xray_id = '9aae2f75-4168-fde3-4570-d7bd0f4669d0' and xi.parity_cents is not null and not xi.skipped
             order by m.name limit p_items loop
    insert into public.xray_item (xray_id, public_menu_item_id, norm_unit, norm_price_cents, parity_cents, pair_status)
    values (p_new, it.public_menu_item_id, it.norm_unit, it.norm_price_cents, it.parity_cents, it.pair_status)
    returning id into new_item;
    insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted)
    select new_item, p.public_menu_item_id, p.similarity, p.accepted from public.xray_pair p where p.xray_item_id = it.id;
  end loop;
end $$;

-- Stores sharing at least k of the copied items with the target, computed from the pairs directly.
create function pg_temp.eligible(p_xray uuid, k int) returns int language sql as $$
  select count(*)::int from (
    select c.public_store_id from public.xray_item xi
      join public.xray_pair p on p.xray_item_id = xi.id and p.accepted
      join public.public_menu_item c on c.id = p.public_menu_item_id
     where xi.xray_id = p_xray
     group by c.public_store_id having count(distinct xi.id) >= k) s
$$;

-- Three items: only neighbors compared on all three are ranked.
select pg_temp.copy_run('00000000-0000-4000-8000-0000000000b3', 3);
select app.snapshot_xray('00000000-0000-4000-8000-0000000000b3');
select ok((select bool_and(items_compared >= 3) from public.xray_store_rank
            where xray_id = '00000000-0000-4000-8000-0000000000b3' and not is_target),
  'B01 M1-10: every ranked neighbor was compared on at least 3 items');
select is((select count(*)::int from public.xray_store_rank where xray_id = '00000000-0000-4000-8000-0000000000b3' and not is_target),
  pg_temp.eligible('00000000-0000-4000-8000-0000000000b3', 3), 'B01 M1-10: neighbors with fewer items are left out');
select ok((select bool_and(stores_ranked = (select count(*) from public.xray_store_rank where xray_id = '00000000-0000-4000-8000-0000000000b3'))
             from public.xray_store_rank where xray_id = '00000000-0000-4000-8000-0000000000b3'),
  'B01 M1-10: N counts only the ranked stores');

-- One item: the target is still ranked, alone.
select pg_temp.copy_run('00000000-0000-4000-8000-0000000000b1', 1);
select app.snapshot_xray('00000000-0000-4000-8000-0000000000b1');
select results_eq($$ select is_target, items_compared, rank, stores_ranked from public.xray_store_rank
                     where xray_id = '00000000-0000-4000-8000-0000000000b1' $$,
  $$ values (true, 1, 1, 1) $$, 'B01 M1-10: the target with 1 item is ranked; no neighbor reaches 3 items');

-- The param is read at calculation time: 2 lets neighbors with 2 items in.
create temp table b3_before as select * from public.xray_store_rank where xray_id = '00000000-0000-4000-8000-0000000000b3';
update public.rule_param set value = 2 where key = 'm1.rank_min_items';
select pg_temp.copy_run('00000000-0000-4000-8000-0000000000b2', 2);
select app.snapshot_xray('00000000-0000-4000-8000-0000000000b2');
select is((select count(*)::int from public.xray_store_rank where xray_id = '00000000-0000-4000-8000-0000000000b2' and not is_target),
  pg_temp.eligible('00000000-0000-4000-8000-0000000000b2', 2), 'B01 M1-10: with the param at 2, neighbors with 2 items are ranked');
select ok(pg_temp.eligible('00000000-0000-4000-8000-0000000000b2', 2) > 0, 'B01 M1-10: the 2-item case has neighbors to rank');

-- Rankings already written stay as they were.
select app.snapshot_xray('00000000-0000-4000-8000-0000000000b3');
select set_eq($$ select public_store_id, rank, stores_ranked, price_index from public.xray_store_rank
                 where xray_id = '00000000-0000-4000-8000-0000000000b3' $$,
              $$ select public_store_id, rank, stores_ranked, price_index from b3_before $$,
  'B01 M1-10: a run already ranked is not ranked again after the param changes');

select * from finish();
rollback;
