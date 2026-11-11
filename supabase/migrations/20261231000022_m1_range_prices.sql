-- M1-13 on P23 (Marlon, 10/nov): a range item says how many stores it was compared with and draws their prices like the
-- exact items do. range_prices keeps one price per store behind the range, cheapest first, without store names.
-- Null for a combo (M1-14), whose range is a sum of parts with no stores of its own.

alter table public.xray_item add column range_prices bigint[];
comment on column public.xray_item.range_prices is 'M1-13: one price per store behind the range, cheapest first. No store identity.';

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
           'combo_parts', i.combo_parts,
           'prices', to_jsonb(i.range_prices))
         order by app.monitor_group_order(i.item_category), m.name collate "C"), '[]'::jsonb)
    from public.xray_item i
    join public.public_menu_item m on m.id = i.public_menu_item_id
    left join public.public_menu_item_snapshot sn on sn.xray_id = i.xray_id and sn.public_menu_item_id = m.id
   where i.xray_id = p_xray and i.comparison_tier = 'faixa' and (i.range_low_cents is not null or i.combo_solo_cents is not null)
$$;
