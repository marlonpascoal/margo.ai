-- Job queue functions (02 §4, A07, A08). Called by workers through the REST API with the service role,
-- or by the local runner over a direct connection. Execute is granted to service_role only.
--
-- Log entries appended to job.log carry ids and event names only, never restaurant names or values (02 §7).

-- One winner: only a queued job can be claimed, so a second delivery of the same wake-up gets nothing.
create function public.claim_job(p_job_id uuid) returns setof public.job
language sql volatile set search_path = '' as $$
  update public.job
     set status = 'running', claimed_at = now(), attempts = attempts + 1, updated_at = now(),
         log = log || jsonb_build_array(jsonb_build_object('at', now(), 'event', 'claimed'))
   where id = p_job_id and status = 'queued'
  returning *
$$;
comment on function public.claim_job(uuid) is
  '02 §4.4: claim one queued job. Returns the row when this caller won, nothing otherwise (A07).';

-- The local runner polls by type. SKIP LOCKED keeps two pollers from waiting on the same row.
create function public.claim_next_job(p_type text) returns setof public.job
language sql volatile set search_path = '' as $$
  with next as (
    select j.id from public.job j
     where j.type = p_type and j.status = 'queued'
     order by j.created_at
     limit 1
     for update skip locked
  )
  update public.job
     set status = 'running', claimed_at = now(), attempts = attempts + 1, updated_at = now(),
         log = log || jsonb_build_array(jsonb_build_object('at', now(), 'event', 'claimed'))
    from next
   where public.job.id = next.id and public.job.status = 'queued'
  returning public.job.*
$$;
comment on function public.claim_next_job(text) is '02 §4.4: claim the oldest queued job of a type.';

-- Close a running job. p_entry is merged into the log entry (e.g. {"reason": "flag_off"}).
create function public.finish_job(p_job_id uuid, p_status public.job_status, p_entry jsonb default '{}')
returns boolean
language plpgsql volatile set search_path = '' as $$
begin
  if p_status not in ('done', 'failed') then
    raise exception 'finish_job takes done or failed, not %', p_status using errcode = 'invalid_parameter_value';
  end if;
  update public.job
     set status = p_status, finished_at = now(), updated_at = now(),
         log = log || jsonb_build_array(
           coalesce(p_entry, '{}') || jsonb_build_object('at', now(), 'event', p_status::text))
   where id = p_job_id and status = 'running';
  return found;
end $$;
comment on function public.finish_job(uuid, public.job_status, jsonb) is
  '02 §4.4: mark a running job done or failed with a log entry. False when the job was not running.';

-- 02 §4.5, C21: a job running for more than 30 minutes returns to queued once; the second time it fails
-- and raises an urgente alert (04 §10: a job that failed twice, like an API import failed twice).
-- p_now is the clock, injectable so tests can move time forward.
create function public.requeue_stuck_jobs(p_now timestamptz default now())
returns table (job_id uuid, outcome text, alert_id uuid)
language plpgsql volatile set search_path = '' as $$
declare
  j record;
  new_alert uuid;
begin
  for j in
    select * from public.job
     where status = 'running' and claimed_at < p_now - interval '30 minutes'
     order by claimed_at
     for update skip locked
  loop
    if not exists (select 1 from jsonb_array_elements(j.log) e where e ->> 'event' = 'stuck_requeued') then
      update public.job
         set status = 'queued', claimed_at = null, updated_at = now(),
             log = log || jsonb_build_array(jsonb_build_object('at', p_now, 'event', 'stuck_requeued'))
       where id = j.id;
      job_id := j.id; outcome := 'requeued'; alert_id := null;
    else
      insert into public.alert (severity, title, account_id, link)
      values ('urgente', format('Tarefa %s travou 2 vezes: mais de 30 minutos rodando', j.type), j.account_id, null)
      returning id into new_alert;
      update public.job
         set status = 'failed', finished_at = p_now, updated_at = now(),
             log = log || jsonb_build_array(jsonb_build_object(
               'at', p_now, 'event', 'failed', 'reason', 'stuck', 'alert_id', new_alert))
       where id = j.id;
      job_id := j.id; outcome := 'failed'; alert_id := new_alert;
    end if;
    return next;
  end loop;
end $$;
comment on function public.requeue_stuck_jobs(timestamptz) is
  '02 §4.5 (A08): requeue jobs running over 30 minutes once, then fail them with an urgente alert.';

revoke all on function public.claim_job(uuid) from public, anon, authenticated;
revoke all on function public.claim_next_job(text) from public, anon, authenticated;
revoke all on function public.finish_job(uuid, public.job_status, jsonb) from public, anon, authenticated;
revoke all on function public.requeue_stuck_jobs(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_job(uuid) to service_role;
grant execute on function public.claim_next_job(text) to service_role;
grant execute on function public.finish_job(uuid, public.job_status, jsonb) to service_role;
grant execute on function public.requeue_stuck_jobs(timestamptz) to service_role;
