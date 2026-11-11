-- M1-15 (Marlon, 10/nov, D82): a sandwich compares only with sandwiches of the same segment (artesanal, lanchonete,
-- smash), the same number of patties or sausages and a similar weight of meat. With too few such stores nearby the
-- item gets no range, and P23 says so: monitor_ranges also lists an item that has a basis and no range.

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
   where i.xray_id = p_xray and i.comparison_tier = 'faixa' and (i.range_low_cents is not null or i.combo_solo_cents is not null or i.range_basis is not null)
$$;
