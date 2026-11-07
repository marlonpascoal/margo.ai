-- M1 extraction: applying copies and the queue operations behind /api/extract and /api/cron/extract
-- (docs/extract-api.md). All of it runs in the database, without the workers. Log entries in job.log carry
-- ids, counts and reasons only (02 §7).

-- Applying a copy -----------------------------------------------------------------------------------------

-- Updates the catalog from one copy. Idempotent, and safe over old copies: a field held by a newer copy of
-- the same store is left alone, as is any field this copy lacks. Never touches founder or manual fields
-- (is_national_chain, xray_store). The street address goes only to public_store_private.
-- last_seen_open_at moves only on an explicit is_open = true, never on write (M1-02).
create function app.apply_extract_copy(p_copy uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.extract_copy;
  p jsonb;
  s jsonb;
  f jsonb;
  newer text[];
  sid uuid;
  it jsonb;
begin
  select * into c from public.extract_copy where id = p_copy;
  if not found then
    raise exception 'unknown extract copy %', p_copy using errcode = 'no_data_found';
  end if;
  select e.payload into p from public.extract_content e where e.content_hash = c.content_hash;
  s := jsonb_strip_nulls(coalesce(p -> 'store', '{}'));

  insert into public.public_store (channel, external_id)
  values (c.channel, c.store_external_id)
  on conflict (channel, external_id) do nothing;
  select ps.id into sid from public.public_store ps
   where ps.channel = c.channel and ps.external_id = c.store_external_id;

  select coalesce(array_agg(distinct k), '{}') into newer
    from public.extract_copy n
    join public.extract_content e on e.content_hash = n.content_hash
    cross join lateral jsonb_object_keys(jsonb_strip_nulls(coalesce(e.payload -> 'store', '{}'))) k
   where n.channel = c.channel and n.store_external_id = c.store_external_id and n.collected_at > c.collected_at;
  f := s - newer;

  update public.public_store ps set
    name = coalesce(f ->> 'name', ps.name),
    url = coalesce(f ->> 'url', ps.url),
    slug = coalesce(f ->> 'slug', ps.slug),
    area = coalesce(f ->> 'area', ps.area),
    category = coalesce(f ->> 'category', ps.category),
    main_category_code = coalesce(f ->> 'main_category_code', ps.main_category_code),
    super_categories = case when f ? 'super_categories'
      then array(select jsonb_array_elements_text(f -> 'super_categories')) else ps.super_categories end,
    rating = coalesce((f ->> 'rating')::numeric, ps.rating),
    rating_count = coalesce((f ->> 'rating_count')::int, ps.rating_count),
    lat = coalesce((f ->> 'lat')::numeric, ps.lat),
    lng = coalesce((f ->> 'lng')::numeric, ps.lng),
    last_seen_open_at = case when (s ->> 'is_open')::boolean is true
      then greatest(ps.last_seen_open_at, c.collected_at) else ps.last_seen_open_at end
   where ps.id = sid;

  if s ? 'address' then
    insert into public.public_store_private (public_store_id, address, collected_at)
    values (sid, s ->> 'address', c.collected_at)
    on conflict (public_store_id) do update
      set address = excluded.address, collected_at = excluded.collected_at
      where public.public_store_private.collected_at <= excluded.collected_at;
  end if;

  if p ? 'items' then
    for it in select jsonb_strip_nulls(v) from jsonb_array_elements(p -> 'items') v loop
      insert into public.public_menu_item (public_store_id, external_item_id, name, description, category,
        taxonomy_level1, taxonomy_level2, price_cents, original_price_cents, minimum_price_cents, unit, unit_qty,
        collected_at)
      values (sid, it ->> 'external_item_id', it ->> 'name', it ->> 'description', it ->> 'category',
        it ->> 'taxonomy_level1', it ->> 'taxonomy_level2', (it ->> 'price_cents')::bigint,
        (it ->> 'original_price_cents')::bigint, (it ->> 'minimum_price_cents')::bigint,
        coalesce((it ->> 'unit')::public.menu_unit, 'un'), (it ->> 'unit_qty')::numeric, c.collected_at)
      on conflict (public_store_id, external_item_id) do update set
        name = excluded.name,
        price_cents = excluded.price_cents,
        description = coalesce(excluded.description, public.public_menu_item.description),
        category = coalesce(excluded.category, public.public_menu_item.category),
        taxonomy_level1 = coalesce(excluded.taxonomy_level1, public.public_menu_item.taxonomy_level1),
        taxonomy_level2 = coalesce(excluded.taxonomy_level2, public.public_menu_item.taxonomy_level2),
        original_price_cents = coalesce(excluded.original_price_cents, public.public_menu_item.original_price_cents),
        minimum_price_cents = coalesce(excluded.minimum_price_cents, public.public_menu_item.minimum_price_cents),
        unit = coalesce((it ->> 'unit')::public.menu_unit, public.public_menu_item.unit),
        unit_qty = coalesce(excluded.unit_qty, public.public_menu_item.unit_qty),
        collected_at = excluded.collected_at,
        removed_at = case when public.public_menu_item.removed_at > excluded.collected_at
                          then public.public_menu_item.removed_at end
       where public.public_menu_item.collected_at <= excluded.collected_at;
    end loop;

    -- An item missing from a newer capture is marked removed, never deleted.
    update public.public_menu_item m set removed_at = c.collected_at
     where m.public_store_id = sid and m.removed_at is null and m.collected_at < c.collected_at
       and not exists (select 1 from jsonb_array_elements(p -> 'items') v
                        where v ->> 'external_item_id' = m.external_item_id);
  end if;
  return sid;
end $$;
comment on function app.apply_extract_copy(uuid) is
  'D47c: apply one copy to public_store, public_menu_item and public_store_private. Idempotent; re-running over old copies is safe.';

-- Queueing ------------------------------------------------------------------------------------------------

-- A queued job, unless one with this dedupe key is active. clock_timestamp keeps the order of the inserts.
create function app.extract_queue_job(p_type text, p_payload jsonb, p_account uuid, p_dedupe text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
begin
  insert into public.job (type, payload, account_id, dedupe_key, created_at)
  values (p_type, p_payload, p_account, p_dedupe, clock_timestamp())
  on conflict (type, dedupe_key) where dedupe_key is not null and status in ('queued', 'running') do nothing
  returning id into new_id;
  return new_id;
end $$;

-- C02: the discovery of the X-ray's target. Null when the flag m1.extracao is off for its account.
create function public.extract_queue_discover(p_xray uuid, p_env public.flag_env default 'sandbox') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  s public.public_store;
  new_id uuid;
begin
  select * into x from public.xray where id = p_xray;
  if not found then
    raise exception 'unknown X-ray %', p_xray using errcode = 'no_data_found';
  end if;
  select * into s from public.public_store where id = x.target_store_id;
  if s.url is null then
    raise exception 'the X-ray has no store URL' using errcode = 'check_violation';
  end if;
  if not public.flag_enabled('m1.extracao', x.account_id, p_env) then
    return null;
  end if;
  new_id := app.extract_queue_job('extract_discover',
    jsonb_build_object('xray_id', x.id, 'channel', s.channel, 'external_id', s.external_id, 'url', s.url,
                       'radius_km', x.radius_km, 'categories', to_jsonb(x.categories)),
    x.account_id, 'extract_discover:' || x.id::text);
  if new_id is null then
    select j.id into new_id from public.job j
     where j.type = 'extract_discover' and j.dedupe_key = 'extract_discover:' || x.id::text
       and j.status in ('queued', 'running');
  end if;
  return new_id;
end $$;

-- A capture of one store, one active job per store.
create function app.extract_queue_capture(p_store uuid, p_account uuid) returns uuid
language sql security definer set search_path = '' as $$
  select app.extract_queue_job('extract_capture',
    jsonb_build_object('public_store_id', s.id, 'channel', s.channel, 'external_id', s.external_id, 'url', s.url),
    p_account, 'extract_capture:' || s.id::text)
    from public.public_store s
   where s.id = p_store and s.url is not null
$$;

-- True when the store has no capture newer than m1.extract_every_days (D47c).
create function app.extract_capture_due(p_store uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.public_store s
      join public.extract_copy c on c.channel = s.channel and c.store_external_id = s.external_id
      join public.extract_run r on r.id = c.run_id and r.kind = 'capture'
     where s.id = p_store
       and c.collected_at > p_now - make_interval(days => coalesce(
         (select p.value::int from public.rule_param p where p.key = 'm1.extract_every_days'), 7)))
$$;

-- After the first neighborhood: capture the target first, then the stores in the set.
create function public.extract_queue_xray_captures(p_xray uuid, p_env public.flag_env default 'sandbox') returns int
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  sid uuid;
  n int := 0;
begin
  select * into x from public.xray where id = p_xray;
  if not found then
    raise exception 'unknown X-ray %', p_xray using errcode = 'no_data_found';
  end if;
  if not public.flag_enabled('m1.extracao', x.account_id, p_env) then
    return 0;
  end if;
  for sid in
    select x.target_store_id
    union all
    select xs.public_store_id from public.xray_store xs
     where xs.xray_id = p_xray and xs.included and xs.public_store_id <> x.target_store_id
  loop
    if app.extract_capture_due(sid, now()) and app.extract_queue_capture(sid, x.account_id) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- D47c, daily cron: captures of the stores of active X-rays whose last capture is older than the param. Active:
-- the newest X-ray of each target that left draft; a delivered lead X-ray and synthetic accounts are out.
create function public.extract_queue_due(p_env public.flag_env default 'sandbox', p_now timestamptz default now())
returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    with latest as (
      select distinct on (x.target_store_id) x.*
        from public.xray x where x.status <> 'draft'
       order by x.target_store_id, x.created_at desc
    ), active as (
      select l.* from latest l left join public.account a on a.id = l.account_id
       where not coalesce(a.is_synthetic, false) and not (l.account_id is null and l.status = 'delivered')
    ), stores as (
      select a.target_store_id as store_id, a.account_id, 0 as ord from active a
      union all
      select xs.public_store_id, a.account_id, 1 from active a
        join public.xray_store xs on xs.xray_id = a.id and xs.included
    )
    select distinct on (s.store_id) s.store_id, s.account_id
      from stores s
     where public.flag_enabled('m1.extracao', s.account_id, p_env)
     order by s.store_id, s.ord
  loop
    if app.extract_capture_due(r.store_id, p_now) and app.extract_queue_capture(r.store_id, r.account_id) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Claim ---------------------------------------------------------------------------------------------------

-- 02 §4: the next queued extract job, one at a time, across every extractor. Stuck jobs follow 02 §4.5 first;
-- a job whose flag is off refuses to run (A05). The extractor sees the url and its parameters only.
create function public.extract_claim_next(p_worker text, p_env public.flag_env default 'sandbox')
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
  if exists (select 1 from public.job jb
              where jb.type in ('extract_discover', 'extract_capture') and jb.status = 'running') then
    return;
  end if;
  loop
    select jb.* into j from public.job jb
     where jb.type in ('extract_discover', 'extract_capture') and jb.status = 'queued'
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

-- What the result endpoint needs before validating a body: null for a job that is not an extract job.
create function public.extract_job_state(p_job uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'kind', case j.type when 'extract_discover' then 'discover' else 'capture' end,
    'status', j.status,
    'external_id', j.payload ->> 'external_id',
    'copies', (select r.copies from public.extract_run r
                where r.job_id = j.id and r.status = 'done' order by r.started_at desc limit 1))
    from public.job j
   where j.id = p_job and j.type in ('extract_discover', 'extract_capture')
$$;

-- Closing a job -------------------------------------------------------------------------------------------

-- The rows a job needs to finish: locked, with the refusals the API maps to 404 and 409.
create function app.extract_running_job(p_job uuid) returns public.job
language plpgsql security definer set search_path = '' as $$
declare
  j public.job;
begin
  select * into j from public.job
   where id = p_job and type in ('extract_discover', 'extract_capture') for update;
  if not found then
    raise exception 'extract_unknown_job';
  end if;
  return j;
end $$;

-- The neighborhood job of an X-ray (worker-collector), unless one is active.
create function app.extract_queue_neighborhood(p_xray uuid, p_account uuid, p_queue_captures boolean) returns uuid
language sql security definer set search_path = '' as $$
  select app.extract_queue_job('xray_neighborhood',
    jsonb_build_object('xray_id', p_xray, 'queue_captures', p_queue_captures),
    p_account, 'xray_neighborhood:' || p_xray::text)
$$;

-- When the last capture of an X-ray still collecting ends, M1-02 runs again: item taxonomies are now known.
create function app.extract_after_capture(p_job public.job) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  x public.xray;
  jid uuid;
  woken uuid[] := '{}';
  sid uuid := (p_job.payload ->> 'public_store_id')::uuid;
begin
  for x in
    select v.* from public.xray v
     where v.status = 'collecting'
       and (v.target_store_id = sid
            or exists (select 1 from public.xray_store xs where xs.xray_id = v.id and xs.public_store_id = sid))
       and not exists (
         select 1 from public.job a
          where a.type = 'extract_capture' and a.status in ('queued', 'running')
            and ((a.payload ->> 'public_store_id')::uuid = v.target_store_id
                 or (a.payload ->> 'public_store_id')::uuid in
                    (select xs.public_store_id from public.xray_store xs where xs.xray_id = v.id)))
  loop
    jid := app.extract_queue_neighborhood(x.id, x.account_id, false);
    if jid is not null then
      woken := woken || jid;
    end if;
  end loop;
  return woken;
end $$;

-- POST result: the run, its copies and their application, in one transaction. p_copies holds the validated
-- payloads as [{external_id, content}]. Repeating a job that ended well changes nothing.
create function public.extract_record_result(p_job uuid, p_source text, p_collected_at timestamptz, p_copies jsonb)
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

-- POST fail: the error stays on the run; the job log gets the reason only (02 §7).
create function public.extract_record_failure(p_job uuid, p_reason text, p_detail text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.job;
  woken uuid[] := '{}';
begin
  j := app.extract_running_job(p_job);
  if j.status <> 'running' then
    raise exception 'extract_job_not_running';
  end if;
  update public.extract_run
     set status = 'failed', finished_at = now(),
         error = p_reason || coalesce(': ' || left(nullif(p_detail, ''), 500), '')
   where job_id = j.id and status = 'running';
  perform public.finish_job(j.id, 'failed', jsonb_build_object('reason', p_reason));
  if j.type = 'extract_capture' then
    woken := app.extract_after_capture(j);
  end if;
  return jsonb_build_object('wake', to_jsonb(woken));
end $$;

-- Reading the discovery ------------------------------------------------------------------------------------

-- M1-01, M1-02: per store, the distance from the X-ray's target in its latest discovery, and its search terms
-- and taxonomies (from the discovery and from its items in the catalog). Never the street address.
create function public.xray_discovery(p_xray uuid)
returns table (public_store_id uuid, distance_m int, terms text[])
language sql stable security definer set search_path = '' as $$
  with t as (
    select s.channel, s.external_id from public.xray x
      join public.public_store s on s.id = x.target_store_id where x.id = p_xray
  ), run as (
    select r.id from public.extract_run r, t
     where r.kind = 'discover' and r.status = 'done'
       and r.request ->> 'external_id' = t.external_id and r.request ->> 'channel' = t.channel::text
     order by r.started_at desc limit 1
  ), disc as (
    select s.id, (e.payload ->> 'distance_km')::numeric as km,
           array(select jsonb_array_elements_text(coalesce(e.payload -> 'search_terms', '[]')
                                                  || coalesce(e.payload -> 'taxonomies', '[]'))) as terms
      from public.extract_copy c
      join run on run.id = c.run_id
      join public.extract_content e on e.content_hash = c.content_hash
      join public.public_store s on s.channel = c.channel and s.external_id = c.store_external_id
  ), tax as (
    select m.public_store_id as id, array_agg(distinct m.taxonomy_level2) as terms
      from public.public_menu_item m
     where m.removed_at is null and m.taxonomy_level2 is not null
     group by m.public_store_id
  )
  select coalesce(d.id, x.id), round(d.km * 1000)::int,
         coalesce(d.terms, '{}') || coalesce(x.terms, '{}')
    from disc d full join tax x on x.id = d.id
$$;

-- Service role only (see 20261031000005_flags.sql).
do $$
declare f text;
begin
  foreach f in array array[
    'app.apply_extract_copy(uuid)',
    'app.extract_queue_job(text, jsonb, uuid, text)',
    'app.extract_queue_capture(uuid, uuid)',
    'app.extract_capture_due(uuid, timestamptz)',
    'app.extract_running_job(uuid)',
    'app.extract_queue_neighborhood(uuid, uuid, boolean)',
    'app.extract_after_capture(public.job)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.extract_queue_discover(uuid, public.flag_env)',
    'public.extract_queue_xray_captures(uuid, public.flag_env)',
    'public.extract_queue_due(public.flag_env, timestamptz)',
    'public.extract_claim_next(text, public.flag_env)',
    'public.extract_job_state(uuid)',
    'public.extract_record_result(uuid, text, timestamptz, jsonb)',
    'public.extract_record_failure(uuid, text, text)',
    'public.xray_discovery(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
