-- Read models for the M1 console screens (C04, C05): one row per X-ray item with its own menu item, the
-- number of comparable items ("Comparáveis") and the example pair (the accepted pair with the highest
-- similarity, else the best candidate). security_invoker: the caller's RLS applies (staff only).

create view public.xray_item_view with (security_invoker = true) as
select
  i.id,
  i.xray_id,
  i.public_menu_item_id,
  m.name,
  m.price_cents as own_cents,
  m.unit,
  m.unit_qty,
  i.norm_unit,
  i.norm_price_cents,
  i.parity_cents,
  i.gap_pct,
  i.loss_cents,
  i.reading,
  i.pair_status,
  i.pair_note,
  i.weekly_units,
  i.reviewed_at,
  i.skipped,
  i.pareto_rank,
  i.pareto_cum_share,
  (select count(*) from public.xray_pair p where p.xray_item_id = i.id)::int as comparables,
  (select count(*) from public.xray_pair p where p.xray_item_id = i.id and p.accepted)::int as accepted_pairs,
  ex.name as example_name,
  ex.price_cents as example_cents
from public.xray_item i
join public.public_menu_item m on m.id = i.public_menu_item_id
left join lateral (
  select pm.name, pm.price_cents
  from public.xray_pair p join public.public_menu_item pm on pm.id = p.public_menu_item_id
  where p.xray_item_id = i.id
  order by p.accepted desc, p.similarity desc, pm.name, pm.id
  limit 1
) ex on true;

comment on view public.xray_item_view is 'C04, C05: X-ray items with comparables count and example pair.';
revoke all on public.xray_item_view from anon;
grant select on public.xray_item_view to authenticated, service_role;
