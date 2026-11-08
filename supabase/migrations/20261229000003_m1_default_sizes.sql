-- M1-04 default sizes (Marlon, 07/nov): a single beverage of a known type with no size takes a default, a size like
-- any other. An explicit size always wins; never for an unreadable type, a combo or a quantity.
--   m1.default_ml.<type>              the type's default when the name says no container (water, as Marlon stated)
--   m1.default_ml.<type>.<container>  the type in a container ("lata"), when the brand's own data says nothing
--   m1.default_size_min_rows / _share a brand and container whose stated size covers at least this share of at least
--                                     this many rows of the X-ray's captured menus takes that size (long neck, KS...)
-- xray_item.size_presumed_ml and xray_pair.size_presumed_ml record the default each side took, so the calculation
-- prices it per 100 ml like the rows that state it; pair_note says "tamanho presumido N ml" (C04).

insert into public.rule_param (key, value, description) values
  ('m1.default_ml.agua', 500, 'M1-04: default size in ml of a water whose name and row give none'),
  ('m1.default_ml.refrigerante.lata', 350, 'M1-04: default size in ml of a soft drink "lata" with no size'),
  ('m1.default_ml.cerveja.lata', 350, 'M1-04: default size in ml of a beer "lata" with no size'),
  ('m1.default_size_min_rows', 5, 'M1-04: stated rows a brand and container need before its size becomes a default'),
  ('m1.default_size_min_share', 0.8, 'M1-04: share of those rows the most common size needs to become the default');

alter table public.xray_item add column size_presumed_ml numeric check (size_presumed_ml > 0);
comment on column public.xray_item.size_presumed_ml is
  'M1-04: the default size in ml the item took when paired; null when it states its size or took none.';
alter table public.xray_pair add column size_presumed_ml numeric check (size_presumed_ml > 0);
comment on column public.xray_pair.size_presumed_ml is
  'M1-04: the default size in ml the comparable item took when paired; null when it states its size or took none.';
