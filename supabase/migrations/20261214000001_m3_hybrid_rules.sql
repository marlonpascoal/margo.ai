-- M3 hybrid ingredient rules (D14 step 2, C11; Marlon, 31/out).
--
-- Before: every confirmation in C11 became a global ingredient_rule that auto-confirmed in every account.
-- Now:
--   ingredient_account_rule: a person's confirmation creates (or reinforces) a rule of that account only.
--     It auto-confirms in that account when the conversion is known, and wins over global rules there.
--     Read by staff and by members of the account (A02); never by another account.
--   ingredient_rule (global, still no account_id and no price): a rule learned from confirmations
--     (source 'confirmation') only suggests until m3.global_rule_min_accounts distinct accounts hold the
--     same account rule and nobody disagreed; then auto_confirm is set and it confirms everywhere.
--     A person picking another ingredient for a line the rule matches sets disputed_at (suggest only,
--     flagged for a founder in C11) until a founder marks it reviewed. Catalog rules (source 'catalog')
--     keep their behavior: they always auto-confirm and are never disputed.
--   ingredient_match.learned_at: the confirmation was counted once into the rules (worker-match).
--
-- Two rules that match one line and name different ingredients confirm nothing: the line goes to C11 as a
-- suggestion to review (worker-match, margo_match.matching.auto_match).

insert into public.rule_param (key, value, description) values
  ('m3.global_rule_min_accounts', 3,
   'D14: distinct accounts that must confirm a learned rule, with no disagreement, before it auto-confirms in every account');

create table public.ingredient_account_rule (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  ingredient_id uuid not null references public.ingredient (id) on delete cascade,
  keywords text[] not null check (cardinality(keywords) > 0),
  ncm_prefix text check (ncm_prefix ~ '^\d{2,8}$'),
  unit text,
  confirmations int not null default 1 check (confirmations > 0),
  created_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (account_id, ingredient_id, keywords, ncm_prefix, unit)
);
create index ingredient_account_rule_key on public.ingredient_account_rule (ingredient_id, keywords);
comment on table public.ingredient_account_rule is
  'D14 step 2, account scope: learned from a confirmation by a person of this account; auto-confirms only here and wins over global rules here. confirmations counts the confirmed matches that taught or reinforced it.';

create trigger set_updated_at before update on public.ingredient_account_rule
  for each row execute function app.set_updated_at();
alter table public.ingredient_account_rule enable row level security;
create policy read on public.ingredient_account_rule for select to authenticated
  using (app.is_staff() or app.is_member(account_id));

alter table public.ingredient_rule
  add column auto_confirm boolean not null default false,
  add column disputed_at timestamptz,
  add column disputed_ingredient_id uuid references public.ingredient (id) on delete set null;
comment on column public.ingredient_rule.auto_confirm is
  'Source confirmation only: true once m3.global_rule_min_accounts accounts confirmed it and disputed_at is null (worker-match). Catalog rules always auto-confirm.';
comment on column public.ingredient_rule.disputed_at is
  'A person picked another ingredient (disputed_ingredient_id) for a line this rule matches: suggest only, flagged for a founder in C11 until reviewed.';

-- Global rules carry no account data: the person who taught a learned rule stays on the account rule only.
update public.ingredient_rule set created_by = null where source = 'confirmation';
alter table public.ingredient_rule
  add constraint ingredient_rule_no_person check (source = 'catalog' or created_by is null);

alter table public.ingredient_match add column learned_at timestamptz;
comment on column public.ingredient_match.learned_at is
  'D14: when worker-match counted this confirmation into the account rule and the global rule (once).';
