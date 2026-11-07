-- M1 load (Marlon, 07/nov): pairing waits for the X-ray's captures, the captures of an X-ray have a cap, and
-- extractors may run several jobs at once up to a limit the server keeps.
--   m1.extract_max_captures_per_xray (30)  the target plus this many stores of the set get a capture, by M1-11
--   m1.rank_weight_*                       M1-11 weights: ratings 50, distance 30, terms 20
--   xray_store.capture_score, capture_rank M1-11, null for stores from before the rule
--   m1.extract_max_running (3)             extract jobs running at once, across every extractor
--   xray_store.capture_slot                the store holds one of the X-ray's capture places; never given back, so
--                                          a re-run cannot queue past the cap
--   public.xray_capture_states             C03: per store of this X-ray, its capture done, missing, failed or beyond_cap
--   public.xray_pair_blocker               what pairing waits for: 'captures', 'neighborhood' or null
-- extract_queue_xray_captures, extract_queue_due, extract_claim_next and xray_confirm_stores are otherwise as before;
-- grants on replaced functions carry over.

insert into public.rule_param (key, value, description) values
  ('m1.extract_max_captures_per_xray', 30, 'D47c: stores of an X-ray that get a capture, nearest first, besides the target'),
  ('m1.extract_max_running', 3, 'docs/extract-api.md: extract jobs running at once, across every extractor'),
  ('m1.rank_weight_ratings', 50, 'M1-11: weight of the rating count in the capture ranking'),
  ('m1.rank_weight_distance', 30, 'M1-11: weight of proximity in the capture ranking'),
  ('m1.rank_weight_terms', 20, 'M1-11: weight of category overlap in the capture ranking');

alter table public.xray_store
  add column capture_slot boolean not null default false,
  add column capture_score numeric(7, 4) check (capture_score between 0 and 100),
  add column capture_rank int check (capture_rank > 0);
comment on column public.xray_store.capture_slot is
  'M1-11: this store holds one of the m1.extract_max_captures_per_xray places.';
comment on column public.xray_store.capture_score is
  'M1-11: score from 0 to 100 among the stores that passed M1-01 and M1-02. Null: filtered out, or from before the rule.';
comment on column public.xray_store.capture_rank is
  'M1-11: position by capture_score in this X-ray. A later capture never rewrites it; a new discovery recalculates it.';

-- M1-11: the free places go to the included stores with the best recorded rank. The rank itself comes from
-- margo_collector.rules.rank_m1_11, the one place that decides. A store with no rank (from before the rule, or put in by
-- hand against the filters) comes after the ranked ones, nearest first; ties by store id.
create function app.xray_capture_fill(p_xray uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  free int;
begin
  select coalesce((select p.value::int from public.rule_param p where p.key = 'm1.extract_max_captures_per_xray'), 30)
         - count(*) into free
    from public.xray_store xs where xs.xray_id = p_xray and xs.capture_slot;
  if free > 0 then
    update public.xray_store u set capture_slot = true
     where u.id in (
       select xs.id from public.xray_store xs
         join public.xray x on x.id = xs.xray_id
        where xs.xray_id = p_xray and xs.included and not xs.capture_slot and xs.public_store_id <> x.target_store_id
        order by xs.capture_rank nulls last, xs.distance_m nulls last, xs.public_store_id
        limit free);
  end if;
end $$;

create or replace function public.extract_queue_xray_captures(p_xray uuid, p_env public.flag_env default 'sandbox') returns int
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
  perform app.xray_capture_fill(p_xray);
  for sid in
    select x.target_store_id
    union all
    select xs.public_store_id from public.xray_store xs
     where xs.xray_id = p_xray and xs.included and xs.capture_slot and xs.public_store_id <> x.target_store_id
  loop
    if app.extract_capture_due(sid, now()) and app.extract_queue_capture(sid, x.account_id) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- D47c, daily cron: as before, within each X-ray's capture places.
create or replace function public.extract_queue_due(p_env public.flag_env default 'sandbox', p_now timestamptz default now())
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
    )
    select l.id from latest l left join public.account a on a.id = l.account_id
     where not coalesce(a.is_synthetic, false) and not (l.account_id is null and l.status = 'delivered')
  loop
    perform app.xray_capture_fill(r.id);
  end loop;
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
        join public.xray_store xs on xs.xray_id = a.id and xs.included and xs.capture_slot
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

-- 02 §4: the next queued extract job, while fewer than m1.extract_max_running run. The advisory lock keeps the count
-- atomic across extractors. Stuck jobs follow 02 §4.5 first, each on its own; a job whose flag is off refuses to run
-- (A05). The extractor sees the url and its parameters only.
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

-- C03: the capture of each store this X-ray compares, from the newest capture job of that store: done, missing (queued
-- or running), failed. An included store past the cap is beyond_cap. A store with no capture job has no row.
create function public.xray_capture_states(p_xray uuid)
returns table (public_store_id uuid, is_target boolean, state text)
language sql stable security definer set search_path = '' as $$
  with x as (
    select v.id, v.target_store_id from public.xray v where v.id = p_xray
  ), used as (
    select count(*) as n from public.xray_store xs where xs.xray_id = p_xray and xs.capture_slot
  ), cap as (
    select coalesce((select p.value::int from public.rule_param p where p.key = 'm1.extract_max_captures_per_xray'), 30) as n
  ), stores as (
    select x.target_store_id as id, true as is_target, false as beyond from x
    union all
    select xs.public_store_id, false, not xs.capture_slot and used.n >= cap.n
      from public.xray_store xs cross join x cross join used cross join cap
     where xs.xray_id = p_xray and xs.included and xs.public_store_id <> x.target_store_id
  ), latest as (
    select distinct on (j.payload ->> 'public_store_id') j.payload ->> 'public_store_id' as store, j.status
      from public.job j
     where j.type = 'extract_capture' and j.payload ->> 'public_store_id' in (select s.id::text from stores s)
     order by j.payload ->> 'public_store_id', j.created_at desc, j.id desc
  )
  select s.id, s.is_target,
         case when s.beyond then 'beyond_cap'
              when l.status = 'done' then 'done'
              when l.status = 'failed' then 'failed'
              else 'missing' end
    from stores s left join latest l on l.store = s.id::text
   where s.beyond or l.status is not null
$$;

-- What pairing waits for. Failed captures do not count; a stuck one ends through 02 §4.5. The neighborhood job counts
-- too: the last capture queues M1-02 again, and pairing before it would read a set about to change.
create function public.xray_pair_blocker(p_xray uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.xray_capture_states(p_xray) s where s.state = 'missing') then 'captures'
    when exists (select 1 from public.job j
                  where j.type = 'xray_neighborhood' and j.status in ('queued', 'running')
                    and j.payload ->> 'xray_id' = p_xray::text) then 'neighborhood'
  end
$$;

create or replace function public.xray_confirm_stores(
  p_xray uuid, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  select count(*) into n from public.xray_store where xray_id = p_xray and included;
  if n = 0 then
    raise exception 'no store in the set' using errcode = 'check_violation';
  end if;
  if public.xray_pair_blocker(p_xray) is not null then
    raise exception 'xray_load_pending' using errcode = 'check_violation';
  end if;
  perform app.xray_step(p_xray, 'xray.confirm_stores', array['collecting', 'pairing', 'ready', 'delivered']::public.xray_status[],
                        'pairing', p_actor, jsonb_build_object('stores_in_set', n), p_ip, p_user_agent);
end $$;

-- X-rays that already exist keep being captured, within the cap.
do $$
declare x uuid;
begin
  for x in select id from public.xray loop
    perform app.xray_capture_fill(x);
  end loop;
end $$;

revoke all on function app.xray_capture_fill(uuid) from public, anon, authenticated;
revoke all on function public.xray_capture_states(uuid) from public, anon, authenticated;
revoke all on function public.xray_pair_blocker(uuid) from public, anon, authenticated;
grant execute on function public.xray_capture_states(uuid) to service_role;
grant execute on function public.xray_pair_blocker(uuid) to service_role;
