-- M1-12 (D73): the review's parameters and tables; rows are readable by staff only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

select is((select value from public.rule_param where key = 'm1.pair_review_target'), 0.95::numeric, 'target');
select is((select value from public.rule_param where key = 'm1.pair_review_max_rounds'), 3::numeric, 'rounds');
select is((select value from public.rule_param where key = 'm1.pair_review_learning_min_runs'), 3::numeric, 'learning runs');
select ok((select relrowsecurity from pg_class where oid = 'public.xray_pair_review'::regclass), 'review has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.m1_pair_review_answer'::regclass), 'answers have RLS');

select * from finish();
rollback;
