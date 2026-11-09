-- Marlon, 08/nov, replaces the best effort of 20261231000017 for the job's outcome: a capture with an item "a partir de"
-- that came without `choices` is incomplete, and incomplete is a failure. The menu and the stored complements stay
-- as before (app.apply_extract_copy is unchanged). The job ends failed with reason incomplete_choices and is not queued
-- again: re-reading complements is a person's decision. Otherwise as in 20261220000002; grants carry over.

create or replace function public.extract_record_result(p_job uuid, p_source text, p_collected_at timestamptz, p_copies jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.job;
  run public.extract_run;
  ch public.channel;
  entry jsonb;
  h text;
  copy_id uuid;
  n int := 0;
  woken uuid[] := '{}';
  jid uuid;
  xid uuid;
  incomplete int;
begin
  j := app.extract_running_job(p_job);
  if j.status = 'done' then
    select * into run from public.extract_run r where r.job_id = j.id and r.status = 'done'
     order by r.started_at desc limit 1;
    return jsonb_build_object('copies', coalesce(run.copies, 0), 'wake', '[]'::jsonb);
  end if;
  select * into run from public.extract_run r where r.job_id = j.id and r.status = 'running';
  if j.status <> 'running' or not found then
    raise exception 'extract_job_not_running';
  end if;
  ch := coalesce(j.payload ->> 'channel', 'ifood')::public.channel;

  for entry in select v from jsonb_array_elements(p_copies) v loop
    h := encode(sha256(convert_to((entry -> 'content')::text, 'UTF8')), 'hex');
    insert into public.extract_content (content_hash, payload) values (h, entry -> 'content')
    on conflict (content_hash) do nothing;
    copy_id := null;
    insert into public.extract_copy (run_id, channel, store_external_id, collected_at, content_hash)
    values (run.id, ch, entry ->> 'external_id', p_collected_at, h)
    on conflict (run_id, channel, store_external_id) do nothing
    returning id into copy_id;
    if copy_id is not null then
      perform app.apply_extract_copy(copy_id);
      n := n + 1;
    end if;
  end loop;

  -- A variable price whose complements did not come: the menu is kept, the capture counts as failed, nothing retries it.
  select count(*) into incomplete
    from jsonb_array_elements(p_copies) e
   cross join lateral jsonb_array_elements(coalesce(e -> 'content' -> 'items', '[]')) i
   where j.type = 'extract_capture' and (i ->> 'price_cents')::bigint = 0
     and coalesce((i ->> 'minimum_price_cents')::bigint, 0) > 0 and not i ? 'choices';
  if incomplete > 0 then
    update public.extract_run set status = 'failed', source = p_source, finished_at = now(), copies = n,
           error = 'incomplete_choices: ' || incomplete || ' item(s)'
     where id = run.id;
    perform public.finish_job(j.id, 'failed', jsonb_build_object('reason', 'incomplete_choices', 'items', incomplete, 'copies', n));
    return jsonb_build_object('copies', n, 'wake', to_jsonb(app.extract_after_capture(j)));
  end if;

  update public.extract_run set status = 'done', source = p_source, finished_at = now(), copies = n where id = run.id;
  perform public.finish_job(j.id, 'done', jsonb_build_object('copies', n));

  if j.type = 'extract_discover' then
    xid := (j.payload ->> 'xray_id')::uuid;
    update public.xray set collected_at = p_collected_at where id = xid;
    jid := app.extract_queue_neighborhood(xid, j.account_id, true);
    if jid is not null then
      woken := array[jid];
    end if;
  else
    woken := app.extract_after_capture(j);
  end if;
  return jsonb_build_object('copies', n, 'wake', to_jsonb(woken));
end $$;
