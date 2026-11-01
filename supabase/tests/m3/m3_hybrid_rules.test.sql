-- D14 step 2, hybrid rules (Marlon, 31/out): account rules, global rules that suggest until enough accounts
-- agree, the threshold as a param, and account isolation of account rules.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

select has_table('public', 'ingredient_account_rule', 'D14: rules scoped to one account');
select col_not_null('public', 'ingredient_account_rule', 'account_id', 'D14: an account rule always names its account');
select hasnt_column('public', 'ingredient_rule', 'account_id', 'D14: global rules carry no account data');
select hasnt_column('public', 'ingredient_rule', 'price_per_base_unit_cents', 'D14: global rules carry no price');
select has_column('public', 'ingredient_rule', 'auto_confirm', 'D14: a learned global rule only suggests until promoted');
select has_column('public', 'ingredient_rule', 'disputed_at', 'D14: a disagreement flags the global rule for a founder');
select is((select value from public.rule_param where key = 'm3.global_rule_min_accounts'), 3::numeric,
  '04 param: distinct accounts before a global rule auto-confirms, default 3');
select is((select count(*)::int from public.ingredient_rule where source = 'confirmation' and auto_confirm), 0,
  'D14: no learned global rule starts auto-confirming');
select is_empty($$
  select cmd from pg_policies where schemaname = 'public' and tablename = 'ingredient_account_rule' and cmd <> 'SELECT'
$$, 'A02: SELECT policies only');
select throws_ok($$
  insert into public.ingredient_rule (ingredient_id, keywords, source, created_by)
  values ((select id from public.ingredient limit 1), array['TESTE'], 'confirmation', (select person_id from public.staff limit 1))
$$, '23514', null, 'D14: a learned global rule never names the person who taught it');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ingredient_account_rule'
                  and qual like '%is_member(account_id)%'),
  'A02: an account rule is read by its own account (and staff), never by another account');

select * from finish();
rollback;
