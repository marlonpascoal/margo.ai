-- M1-13 (Marlon, 08/nov, D75): the price range of food with no exact comparison uses dish families, read by AI for every
-- food item and kept by pattern, so a menu is classified once.
--
--   m1_item_family  one pattern (name tokens, description hints, section): family, main protein, size class. Business
--                   menu data only, global like m1_attr_learning (no account, no store).

create table public.m1_item_family (
  pattern text primary key,
  family text not null,
  protein text not null,
  size_class text not null check (size_class in ('mini', 'individual', 'normal', 'grande', 'compartilhar')),
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.m1_item_family is
  'M1-13: what kind of dish a food item is, read by AI once per pattern, for the price range of items with no exact comparison.';

create trigger set_updated_at before update on public.m1_item_family
  for each row execute function app.set_updated_at();
alter table public.m1_item_family enable row level security;
create policy read on public.m1_item_family for select to authenticated using (app.is_staff());

alter table public.xray_item add column range_basis text;
comment on column public.xray_item.range_basis is 'M1-13: what the range compares with, in words, such as "temaki de salmão".';

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
           'basis', i.range_basis)
         order by app.monitor_group_order(i.item_category), m.name collate "C"), '[]'::jsonb)
    from public.xray_item i
    join public.public_menu_item m on m.id = i.public_menu_item_id
    left join public.public_menu_item_snapshot sn on sn.xray_id = i.xray_id and sn.public_menu_item_id = m.id
   where i.xray_id = p_xray and i.comparison_tier = 'faixa' and i.range_low_cents is not null
$$;
revoke all on function public.monitor_ranges(uuid) from public, anon, authenticated;
grant execute on function public.monitor_ranges(uuid) to service_role;
