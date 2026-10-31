-- A07, A08: job queue functions (02 §4). The Python runner tests drive the same functions end to end.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- Only the service role may call the queue functions.
select ok(not has_function_privilege('anon', 'public.claim_job(uuid)', 'execute'), 'anon cannot claim_job');
select ok(not has_function_privilege('authenticated', 'public.claim_job(uuid)', 'execute'), 'authenticated cannot claim_job');
select ok(not has_function_privilege('authenticated', 'public.claim_next_job(text)', 'execute'), 'authenticated cannot claim_next_job');
select ok(not has_function_privilege('authenticated', 'public.finish_job(uuid,public.job_status,jsonb)', 'execute'), 'authenticated cannot finish_job');
select ok(not has_function_privilege('authenticated', 'public.requeue_stuck_jobs(timestamptz)', 'execute'), 'authenticated cannot requeue_stuck_jobs');
select ok(has_function_privilege('service_role', 'public.claim_job(uuid)', 'execute'), 'service_role can claim_job');
select ok(has_function_privilege('service_role', 'public.requeue_stuck_jobs(timestamptz)', 'execute'), 'service_role can requeue_stuck_jobs');

insert into public.job (id, type, dedupe_key) values
  ('00000000-0000-4000-8000-0000000000a7', 'test_a07', 'k-a07'),
  ('00000000-0000-4000-8000-0000000000a8', 'test_a08', 'k-a08');

-- A07: one winner.
select is((select count(*) from public.claim_job('00000000-0000-4000-8000-0000000000a7'))::int, 1, 'A07: first claim wins');
select is((select count(*) from public.claim_job('00000000-0000-4000-8000-0000000000a7'))::int, 0, 'A07: second claim gets nothing');
select results_eq($$ select status::text, attempts from public.job where id = '00000000-0000-4000-8000-0000000000a7' $$,
  $$ values ('running', 1) $$, 'A07: claimed once, attempts 1');
select throws_ok($$ insert into public.job (type, dedupe_key) values ('test_a07', 'k-a07') $$, '23505', null,
  'A07: an active job with the same dedupe key cannot be enqueued twice');
select ok(public.finish_job('00000000-0000-4000-8000-0000000000a7', 'done', '{"rows": 3}'), 'finish_job closes a running job');
select ok(not public.finish_job('00000000-0000-4000-8000-0000000000a7', 'failed'), 'finish_job leaves a finished job alone');
select is((select log -> -1 ->> 'event' from public.job where id = '00000000-0000-4000-8000-0000000000a7'), 'done',
  'finish_job appends the closing log entry');
select throws_ok($$ select public.finish_job('00000000-0000-4000-8000-0000000000a7', 'queued') $$, '22023', null,
  'finish_job refuses statuses other than done and failed');

-- A08: stuck once, requeued; stuck again, failed with an alert.
select is((select count(*) from public.claim_next_job('test_a08'))::int, 1, 'claim_next_job claims the queued job');
select is_empty($$ select * from public.requeue_stuck_jobs(now() + interval '29 minutes') $$,
  'A08: running under 30 minutes is not stuck');
select results_eq($$ select outcome from public.requeue_stuck_jobs(now() + interval '31 minutes') $$,
  $$ values ('requeued') $$, 'A08: stuck the first time, requeued');
select results_eq($$ select status::text, claimed_at is null from public.job where id = '00000000-0000-4000-8000-0000000000a8' $$,
  $$ values ('queued', true) $$, 'A08: back in the queue');
select is((select count(*) from public.claim_job('00000000-0000-4000-8000-0000000000a8'))::int, 1, 'A08: claimed again');
select results_eq($$ select outcome, alert_id is not null from public.requeue_stuck_jobs(now() + interval '31 minutes') $$,
  $$ values ('failed', true) $$, 'A08: stuck the second time, failed with an alert');
select results_eq(
  $$ select j.status::text, j.attempts, a.severity::text from public.job j
       join public.alert a on a.id = (j.log -> -1 ->> 'alert_id')::uuid
      where j.id = '00000000-0000-4000-8000-0000000000a8' $$,
  $$ values ('failed', 2, 'urgente') $$, 'A08: job failed after two attempts, alert is urgente');

select * from finish();
rollback;
