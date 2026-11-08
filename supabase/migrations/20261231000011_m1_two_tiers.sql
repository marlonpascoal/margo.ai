-- M1-13 (Marlon, 08/nov, D74): two levels of comparison. Shelf items and food with a known size keep the exact
-- comparison. Food with no size written on either side gets only a price range of similar items: no parity, no reading,
-- no price gap.
--
-- Gated by the new flag m1.comparacao_faixa, off by default in both environments.

insert into public.feature_flag (key, description, default_raio_x, default_lucro, default_rede, env)
select 'm1.comparacao_faixa', 'Faixa de preço para comida sem tamanho escrito no resultado do raio-X', false, false, false,
       s::public.flag_env
  from unnest(array['sandbox', 'production']) s;

alter table public.xray_item
  add column comparison_tier text check (comparison_tier in ('exata', 'faixa')),
  add column range_low_cents bigint check (range_low_cents >= 0),
  add column range_high_cents bigint check (range_high_cents >= 0),
  add column range_stores int check (range_stores >= 0),
  add column range_position text check (range_position in ('abaixo', 'dentro', 'acima'));
comment on column public.xray_item.comparison_tier is
  'M1-13: exata (parity) or faixa (price range only). Null on runs calculated with m1.comparacao_faixa off.';

-- P23 "Referência de faixa": the items compared by range, with what the owner needs to read them. Service role only,
-- like the other monitor_* loaders: the portal checks the person first (D63).
create function public.monitor_ranges(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.id,
           'name', m.name,
           'own_cents', coalesce(sn.price_cents, m.comparison_price_cents),
           'low_cents', i.range_low_cents,
           'high_cents', i.range_high_cents,
           'stores', i.range_stores,
           'position', i.range_position)
         order by app.monitor_group_order(i.item_category), m.name collate "C"), '[]'::jsonb)
    from public.xray_item i
    join public.public_menu_item m on m.id = i.public_menu_item_id
    left join public.public_menu_item_snapshot sn on sn.xray_id = i.xray_id and sn.public_menu_item_id = m.id
   where i.xray_id = p_xray and i.comparison_tier = 'faixa' and i.range_low_cents is not null and not i.skipped
$$;
revoke all on function public.monitor_ranges(uuid) from public, anon, authenticated;
grant execute on function public.monitor_ranges(uuid) to service_role;
