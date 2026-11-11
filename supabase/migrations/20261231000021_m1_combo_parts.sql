-- M1-14 (Marlon, 10/nov, D81): a combo compares by the sum of its parts. The worker splits it ("4 Dog + Coca 2 litros"),
-- finds each part among the store's own single items and keeps two readings: the parts bought singly in the same
-- store (combo_solo_cents) and the neighbors' sum of the parts' references, in the range columns of M1-13 with
-- range_basis "soma das partes". monitor_ranges also lists a combo that has only the first reading.

alter table public.xray_item
  add column combo_solo_cents bigint check (combo_solo_cents >= 0),
  add column combo_parts jsonb;
comment on column public.xray_item.combo_solo_cents is 'M1-14: the combo''s parts bought singly in the same store.';
comment on column public.xray_item.combo_parts is 'M1-14: each part as read: [{part, qty, item, price_cents}].';

create or replace function public.monitor_ranges(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.id,
           'name', m.name,
           'own_cents', coalesce(sn.price_cents, m.comparison_price_cents),
           'low_cents', i.range_low_cents,
           'high_cents', i.range_high_cents,
           'stores', i.range_stores,
           'position', i.range_position,
           'basis', i.range_basis,
           'combo_solo_cents', i.combo_solo_cents,
           'combo_parts', i.combo_parts)
         order by app.monitor_group_order(i.item_category), m.name collate "C"), '[]'::jsonb)
    from public.xray_item i
    join public.public_menu_item m on m.id = i.public_menu_item_id
    left join public.public_menu_item_snapshot sn on sn.xray_id = i.xray_id and sn.public_menu_item_id = m.id
   where i.xray_id = p_xray and i.comparison_tier = 'faixa' and (i.range_low_cents is not null or i.combo_solo_cents is not null)
$$;
