-- M1-18 (D86, Marlon 11/nov): a dish with only 3 or 4 comparable stores gets an indicative range, shown as "poucas
-- lojas". It stays out of "Itens alinhados": the score counts only ranges built on the minimum of stores. Earlier
-- runs had no range under the minimum, so their v4 rows read the same under this definition.
create or replace function app.score_items_m1_12(p_xray uuid)
returns table (item uuid, item_category text, reading public.xray_reading, own_cents bigint, parity_cents bigint)
language sql stable security definer set search_path = '' as $$
  select distinct on (p.public_menu_item_id) p.public_menu_item_id, p.item_category, p.reading, p.own_cents, p.parity_cents
    from public.xray_item_position p where p.xray_id = p_xray and p.reading is not null
  union all
  select i.public_menu_item_id, i.item_category,
         (case i.range_position when 'dentro' then 'na_media' when 'abaixo' then 'pode_subir' else 'nao_mexer' end)::public.xray_reading,
         null, null
    from public.xray_item i
   where i.xray_id = p_xray and i.comparison_tier = 'faixa' and i.combo_solo_cents is null and i.range_position is not null
     and coalesce(i.range_stores, 0) >= app.monitor_param('m1.range_min_stores', 5)::int
     and not exists (select 1 from public.xray_item_position p where p.xray_id = p_xray and p.xray_item_id = i.id)
$$;
