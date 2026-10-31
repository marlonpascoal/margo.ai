-- G-SYN, module 1 history: an earlier X-ray of Pantanos Burguer (28/set/2026) kept only as its dated
-- snapshots, then the snapshots of the X-ray of 28/out (app.snapshot_xray, M1-10). Synthetic (D46): the
-- September prices are the October ones moved by a fixed rule (items 1, 4 and 7 cost R$ 2,00 less; item 2
-- costs R$ 1,00 more), so the history view has something to show.

insert into public.xray (id, account_id, target_store_id, radius_km, categories, rules, status, collected_at,
                         delivered_at, created_at) values
  ('9aae2f75-4168-fde3-4570-d7bd0f460928', '7876ec36-6300-3834-5468-98cc88f67dcb',
   'ffffa5b5-8743-e8a8-7736-fa97c275e3b4', 3, array['Lanches', 'Hambúrguer', 'Porções']::text[], '{}'::jsonb,
   'delivered', '2026-09-28T10:00:00-03:00', '2026-09-28T16:00:00-03:00', '2026-09-28T09:30:00-03:00');

insert into public.public_store_snapshot (xray_id, public_store_id, name, area, category, is_national_chain,
                                          last_seen_open_at, collected_at)
select '9aae2f75-4168-fde3-4570-d7bd0f460928', id, name, area, category, is_national_chain,
       '2026-09-28T10:00:00-03:00', '2026-09-28T10:00:00-03:00'
  from public.public_store where id = 'ffffa5b5-8743-e8a8-7736-fa97c275e3b4';

insert into public.public_menu_item_snapshot (xray_id, public_store_id, public_menu_item_id, name, price_cents,
                                              unit, unit_qty, collected_at)
select '9aae2f75-4168-fde3-4570-d7bd0f460928', public_store_id, id, name,
       price_cents + case n when 1 then -200 when 4 then -200 when 7 then -200 when 2 then 100 else 0 end,
       unit, unit_qty, '2026-09-28T10:00:00-03:00'
  from (select i.*, row_number() over (order by i.name) as n
          from public.public_menu_item i where i.public_store_id = 'ffffa5b5-8743-e8a8-7736-fa97c275e3b4') t;

insert into public.xray_store_rank (xray_id, public_store_id, is_target, price_index, items_compared, rank, stores_ranked)
values ('9aae2f75-4168-fde3-4570-d7bd0f460928', 'ffffa5b5-8743-e8a8-7736-fa97c275e3b4', true, 0.9400, 10, 24, 80);

select app.snapshot_xray('9aae2f75-4168-fde3-4570-d7bd0f4669d0');
