-- M1 retry in the queue (Marlon, 07/nov): the extractor makes one attempt per claim and reports it; MargoAI decides.
--   m1.extract_retry_reason_<reason>  1 transitory (retried), 0 permanent; the one place that classes a fail reason.
--                                     An unknown reason is permanent. 'stuck' is the 02 §4.5 recovery, not sent by extractors
--   m1.extract_max_attempts (3)       attempts of an extract job in all, the first included; job.attempts counts them, one
--                                     per claim
--   m1.extract_retry_wait_minutes_N   the wait after the Nth failed attempt (10, 30); a later attempt waits as the last N
--   job.not_before                    a queued job is not claimed before this time
--   app.extract_retry_at              when a failed attempt runs again, or null when the job fails now
--   public.xray_capture_retries       C03: stores whose capture waits to retry, and when
-- extract_record_failure, extract_claim_next and requeue_stuck_jobs are otherwise as before; grants on replaced
-- functions carry over. A job waiting to retry stays queued, so its dedupe key stays active (no duplicate from the
-- daily cron) and xray_capture_states counts it as missing, which holds the pairing (xray_pair_blocker unchanged).

insert into public.rule_param (key, value, description) values
  ('m1.extract_max_attempts', 3, 'docs/extract-api.md: attempts of an extract job in all, the first included; one per claim'),
  ('m1.extract_retry_wait_minutes_1', 10, 'docs/extract-api.md: minutes before an extract job runs again after its first failed attempt'),
  ('m1.extract_retry_wait_minutes_2', 30, 'docs/extract-api.md: minutes before an extract job runs again after its second failed attempt, and any later one'),
  ('m1.extract_retry_reason_blocked', 1, 'docs/extract-api.md: fail reason blocked is transitory (1) and retried, or permanent (0)'),
  ('m1.extract_retry_reason_timeout', 1, 'docs/extract-api.md: fail reason timeout is transitory (1) and retried, or permanent (0)'),
  ('m1.extract_retry_reason_network', 1, 'docs/extract-api.md: fail reason network is transitory (1) and retried, or permanent (0)'),
  ('m1.extract_retry_reason_stuck', 1, '02 §4.5: an extract job stuck in running is transitory (1) and retried, or permanent (0)'),
  ('m1.extract_retry_reason_not_found', 0, 'docs/extract-api.md: fail reason not_found is transitory (1) and retried, or permanent (0)'),
  ('m1.extract_retry_reason_parse_error', 0, 'docs/extract-api.md: fail reason parse_error is transitory (1) and retried, or permanent (0)'),
  ('m1.extract_retry_reason_other', 0, 'docs/extract-api.md: fail reason other is transitory (1) and retried, or permanent (0)');

alter table public.job add column not_before timestamptz;
comment on column public.job.not_before is
  'A queued job is not claimed before this time. Set when a failed extract attempt waits to retry (docs/extract-api.md).';

-- When a failed attempt runs again: p_now plus the wait for p_attempts, while the reason is transitory and attempts are
-- left; null when the job fails now.
create function app.extract_retry_at(p_reason text, p_attempts int, p_now timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case
    when coalesce((select p.value from public.rule_param p where p.key = 'm1.extract_retry_reason_' || p_reason), 0) <> 1
      or p_attempts >= coalesce((select p.value::int from public.rule_param p where p.key = 'm1.extract_max_attempts'), 3)
    then null
    else p_now + make_interval(mins => coalesce(
      (select p.value::int from public.rule_param p
        where p.key ~ '^m1\.extract_retry_wait_minutes_[0-9]+$'
          and substring(p.key from '[0-9]+$')::int <= p_attempts
        order by substring(p.key from '[0-9]+$')::int desc limit 1), 10))
  end
$$;

-- POST fail: the error stays on the run; the job log gets the reason only (02 §7). A transitory reason with attempts
-- left puts the same job back in the queue until not_before; otherwise the job fails, and a failed capture wakes the
-- neighborhood as before.
create or replace function public.extract_record_failure(p_job uuid, p_reason text, p_detail text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.job;
  woken uuid[] := '{}';
  retry timestamptz;
begin
  j := app.extract_running_job(p_job);
  if j.status <> 'running' then
    raise exception 'extract_job_not_running';
  end if;
  update public.extract_run
     set status = 'failed', finished_at = now(),
         error = p_reason || coalesce(': ' || left(nullif(p_detail, ''), 500), '')
   where job_id = j.id and status = 'running';
  retry := app.extract_retry_at(p_reason, j.attempts, now());
  if retry is not null then
    update public.job
       set status = 'queued', claimed_at = null, not_before = retry, updated_at = now(),
           log = log || jsonb_build_array(jsonb_build_object(
             'at', now(), 'event', 'retry_queued', 'reason', p_reason, 'not_before', retry))
     where id = j.id;
    return jsonb_build_object('wake', '[]'::jsonb);
  end if;
  perform public.finish_job(j.id, 'failed', jsonb_build_object('reason', p_reason));
  if j.type = 'extract_capture' then
    woken := app.extract_after_capture(j);
  end if;
  return jsonb_build_object('wake', to_jsonb(woken));
end $$;

-- 02 §4: the next queued extract job whose not_before has passed, oldest first, while fewer than m1.extract_max_running
-- run. Otherwise as in 20261225000001.
create or replace function public.extract_claim_next(p_worker text, p_env public.flag_env default 'sandbox')
returns table (job_id uuid, kind public.extract_kind, payload jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  j public.job;
  k public.extract_kind;
  req jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('extract_claim', 0));
  perform 1 from public.requeue_stuck_jobs(now());
  update public.extract_run r set status = 'failed', error = 'stuck', finished_at = now()
    from public.job jb
   where jb.id = r.job_id and r.status = 'running' and jb.status <> 'running';
  if (select count(*) from public.job jb
       where jb.type in ('extract_discover', 'extract_capture') and jb.status = 'running')
     >= coalesce((select p.value::int from public.rule_param p where p.key = 'm1.extract_max_running'), 3) then
    return;
  end if;
  loop
    select jb.* into j from public.job jb
     where jb.type in ('extract_discover', 'extract_capture') and jb.status = 'queued'
       and (jb.not_before is null or jb.not_before <= now())
     order by jb.created_at, jb.id
     limit 1 for update skip locked;
    if not found then
      return;
    end if;
    perform 1 from public.claim_job(j.id);
    if public.flag_enabled('m1.extracao', j.account_id, p_env) then
      exit;
    end if;
    perform public.finish_job(j.id, 'failed', '{"reason": "flag_off"}');
  end loop;

  k := case j.type when 'extract_discover' then 'discover' else 'capture' end;
  req := case k
    when 'discover' then jsonb_build_object('url', j.payload -> 'url', 'radius_km', j.payload -> 'radius_km',
                                            'categories', j.payload -> 'categories')
    else jsonb_build_object('url', j.payload -> 'url') end;
  insert into public.extract_run (job_id, kind, worker, request)
  values (j.id, k, p_worker, req || jsonb_build_object('channel', j.payload -> 'channel', 'external_id', j.payload -> 'external_id'));
  job_id := j.id; kind := k; payload := req;
  return next;
end $$;

-- 02 §4.5, C21: a job running for more than 30 minutes returns to queued once; the second time it fails and raises an
-- urgente alert. An extract job instead counts the stuck claim as one of its attempts (reason 'stuck'): with attempts
-- left it waits like any transitory failure, after the last it fails with the alert. Security definer to read the
-- params through app.extract_retry_at; execute stays with service_role.
create or replace function public.requeue_stuck_jobs(p_now timestamptz default now())
returns table (job_id uuid, outcome text, alert_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare
  j record;
  new_alert uuid;
  is_extract boolean;
  retry timestamptz;
begin
  for j in
    select * from public.job
     where status = 'running' and claimed_at < p_now - interval '30 minutes'
     order by claimed_at
     for update skip locked
  loop
    is_extract := j.type in ('extract_discover', 'extract_capture');
    retry := case when is_extract then app.extract_retry_at('stuck', j.attempts, p_now) end;
    if (is_extract and retry is not null)
       or (not is_extract and not exists (select 1 from jsonb_array_elements(j.log) e where e ->> 'event' = 'stuck_requeued')) then
      update public.job
         set status = 'queued', claimed_at = null, not_before = retry, updated_at = now(),
             log = log || jsonb_build_array(jsonb_build_object('at', p_now, 'event', 'stuck_requeued'))
       where id = j.id;
      job_id := j.id; outcome := 'requeued'; alert_id := null;
    else
      insert into public.alert (severity, title, account_id, link)
      values ('urgente',
              case when is_extract then format('Tarefa %s travou na última tentativa: mais de 30 minutos rodando', j.type)
                   else format('Tarefa %s travou 2 vezes: mais de 30 minutos rodando', j.type) end,
              j.account_id, null)
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

-- C03: the stores of this X-ray whose newest capture job waits to retry, and when it runs again. Such a store is
-- 'missing' in xray_capture_states, so pairing waits for it.
create function public.xray_capture_retries(p_xray uuid)
returns table (public_store_id uuid, retry_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.public_store_id, l.not_before
    from public.xray_capture_states(p_xray) s
    cross join lateral (
      select j.status, j.not_before from public.job j
       where j.type = 'extract_capture' and j.payload ->> 'public_store_id' = s.public_store_id::text
       order by j.created_at desc, j.id desc limit 1) l
   where s.state = 'missing' and l.status = 'queued' and l.not_before > now()
$$;

revoke all on function app.extract_retry_at(text, int, timestamptz) from public, anon, authenticated;
revoke all on function public.xray_capture_retries(uuid) from public, anon, authenticated;
grant execute on function public.xray_capture_retries(uuid) to service_role;
