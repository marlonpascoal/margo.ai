-- P23 "Onde está o peso do seu cardápio" (Marlon, 10/nov, D83): the 80:20 of the menu, not of the compared items only.
-- Without sales, an item weighs its price and its section; a section the store calls "mais pedidos" marks its best
-- sellers. Each own item says how it was compared (exata, faixa, combo) or why not.

create function public.monitor_menu_weight(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.id,
           'name', m.name,
           'section', coalesce(nullif(trim(m.category), ''), 'Sem seção'),
           'price_cents', coalesce(sn.price_cents, m.comparison_price_cents, 0),
           'kind', case when i.parity_cents is not null then 'exata'
                        when i.combo_solo_cents is not null then 'combo'
                        when i.range_low_cents is not null then 'faixa'
                        else 'sem' end,
           'reason', coalesce(i.range_basis, i.pair_note),
           'most_ordered', coalesce(m.category, '') ~* 'mais\s+pedid')
         order by m.category, m.name collate "C"), '[]'::jsonb)
    from public.xray_item i
    join public.public_menu_item m on m.id = i.public_menu_item_id
    left join public.public_menu_item_snapshot sn on sn.xray_id = i.xray_id and sn.public_menu_item_id = m.id
   where i.xray_id = p_xray
$$;
revoke all on function public.monitor_menu_weight(uuid) from public, anon, authenticated;
grant execute on function public.monitor_menu_weight(uuid) to service_role;
