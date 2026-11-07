-- M1-04 Stage 1 (Marlon, 07/nov): pairing by category and, for beverages, by attributes.
--   public_menu_item.size_from_name_ml  the size app.size_from_name_m1_03 reads in the name, in ml, whatever the unit
--                                       columns hold (G-SYN rows keep their unit "un" as drawn). Same single parser.
--   xray_item.item_category             the item's category when it was paired; null before this rule or when nothing
--                                       says one.
--   xray_item_view.example_*            a beverage shows only an accepted item as "Exemplo de par" (B4): nothing
--                                       else it could list is the same product. Other categories as before.

-- M1-03, the one parser, on shapes seen in real menus: "s/açúcar" and "c/ gás" are words, not a list of items; "lata com
-- 350ml" says one size; a leading menu code ("301 - refri 600ml") is no number of the item; the same size twice ("350ml - cola - pet 350ml") is one size; a size glued to a word ("uva2 litros").
-- Two different sizes stay ambiguous. Copies are applied again below, as when the parser came in.
create or replace function app.size_from_name_m1_03(p_name text, out unit public.menu_unit, out qty numeric)
language plpgsql immutable set search_path = '' as $$
declare
  size_re constant text :=
    '(?:^|[^a-z0-9.,])(\d+(?:[.,]\d+)?)\s*(mls?|lts?|litros?|l|grs?|gramas?|g|kgs?|kilos?|quilos?|und?|unids?|unidades?)(?![a-z0-9])';
  many_re constant text :=
    '\m(combos?|kits?|combinados?|promo|promocao|acompanha\w*|mais|com|leve|pague|dois|duas|tres|quatro|cinco|seis|e|ou)\M|[+&/]|,(?!\d)|(?<!\d),';
  n text;
  hits int;
  m text[];
  num text;
  word text;
  v numeric;
begin
  n := lower(translate(p_name, 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
                               'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'));
  n := regexp_replace(n, '^\s*\d+\s*-\s*(?=[a-z])', '');
  n := regexp_replace(n, '\ms/\s*(?=[a-z])', 'sem ', 'g');
  n := regexp_replace(n, '\mc/\s*(?=[a-z])', 'com ', 'g');
  n := regexp_replace(n, '\mcom gas\M', 'gas', 'g');
  n := regexp_replace(n, '\mcom\s+(?=\d)', '', 'g');
  n := regexp_replace(n, '([a-z]{2})(\d+(?:[.,]\d+)?\s*(?:mls?|lts?|litros?|l)\M)', '\1 \2', 'g');
  if n is null or n ~ many_re then
    return;
  end if;
  select count(distinct (h[1], left(h[2], 1))) into hits from regexp_matches(n, size_re, 'g') h;
  if hits <> 1 or regexp_replace(n, size_re, ' ', 'g') ~ '\m\d+(?:[.,]\d+)?x?\M' then
    return;
  end if;
  m := regexp_match(n, size_re);
  num := m[1];
  word := m[2];

  if num ~ '^[1-9]\d{0,2}\.\d{3}$' then
    if word !~ '^(ml|g)' then
      return;
    end if;
    num := replace(num, '.', '');
  elsif num ~ ',\d{3}$' and word ~ '^(ml|g)' then
    return;
  end if;
  v := replace(num, ',', '.')::numeric;

  if word ~ '^(l|kg|kilo|quilo)' then
    v := v * 1000;
  end if;
  if word ~ '^un' then
    if v <> trunc(v) or v < 1 or v > 1000 then
      return;
    end if;
    unit := 'un';
  else
    if v < 1 or v > 100000 then
      return;
    end if;
    unit := case when word ~ '^(ml|l)' then 'ml' else 'g' end;
  end if;
  qty := round(v, 2);
end $$;

-- Security definer: whoever writes a menu row computes the column, and the parser stays closed to them.
create function app.size_from_name_ml_m1_04(p_name text) returns numeric
language sql immutable security definer set search_path = '' as $$
  select case when s.unit = 'ml' then s.qty end from app.size_from_name_m1_03(p_name) s
$$;
revoke all on function app.size_from_name_ml_m1_04(text) from public, anon;
grant execute on function app.size_from_name_ml_m1_04(text) to authenticated, service_role;

alter table public.public_menu_item
  add column size_from_name_ml numeric generated always as (app.size_from_name_ml_m1_04(name)) stored;
comment on column public.public_menu_item.size_from_name_ml is
  'M1-04: the beverage size app.size_from_name_m1_03 reads in the name, in ml; null when it reads none.';

alter table public.xray_item add column item_category text
  check (item_category in ('bebidas', 'lanches', 'porcoes', 'pratos', 'sobremesas', 'adicionais'));
comment on column public.xray_item.item_category is
  'M1-04: the item''s category when paired, from taxonomy, menu section or rule. Null when nothing says one.';

create or replace view public.xray_item_view with (security_invoker = true) as
select
  i.id,
  i.xray_id,
  i.public_menu_item_id,
  m.name,
  coalesce(sn.price_cents, m.comparison_price_cents) as own_cents,
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
  ex.price_cents as example_cents,
  i.parity_full_cents,
  i.gap_full_pct,
  i.full_price_room
from public.xray_item i
join public.public_menu_item m on m.id = i.public_menu_item_id
left join public.public_menu_item_snapshot sn on sn.xray_id = i.xray_id and sn.public_menu_item_id = m.id
left join lateral (
  select pm.name, coalesce(psn.price_cents, pm.comparison_price_cents) as price_cents
  from public.xray_pair p join public.public_menu_item pm on pm.id = p.public_menu_item_id
  left join public.public_menu_item_snapshot psn on psn.xray_id = i.xray_id and psn.public_menu_item_id = pm.id
  where p.xray_item_id = i.id and (p.accepted or i.item_category is distinct from 'bebidas')
  order by p.accepted desc, p.similarity desc, pm.name, pm.id
  limit 1
) ex on true;


-- Copies already applied pick the better read up, oldest first. Rows without a copy (G-SYN) are not touched.
do $$
declare c uuid;
begin
  for c in
    select cp.id from public.extract_copy cp join public.extract_content e on e.content_hash = cp.content_hash
     where e.payload ? 'items' order by cp.collected_at, cp.id
  loop
    perform app.apply_extract_copy(c);
  end loop;
end $$;
