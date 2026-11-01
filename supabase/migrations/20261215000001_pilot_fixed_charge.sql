-- Pilots charge from day 61 (Marlon, 31/out; 04 §7, D37). Besides the percentage charge of months 1 and 2,
-- the daily billing cron creates a fixed monthly charge from day 61. Both live in pilot_charge, one row per
-- pilot, month and kind, so a month can hold the last percentage charge and the first fixed one, and a
-- second run never charges twice.

alter table public.pilot_charge
  add column kind text not null default 'pct' check (kind in ('pct', 'fixed'));
comment on column public.pilot_charge.kind is
  'pct: pct_months_1_2 of the credited amount (days 1 to 60). fixed: monthly charge from day 61 (units x price).';

alter table public.pilot_charge drop constraint pilot_charge_pilot_id_month_key;
alter table public.pilot_charge add constraint pilot_charge_pilot_id_month_kind_key unique (pilot_id, month, kind);
