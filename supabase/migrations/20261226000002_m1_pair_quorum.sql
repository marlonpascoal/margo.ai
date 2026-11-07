-- Pairing no longer waits for every capture (Marlon, 07/nov).
--   m1.pair_min_captures_pct (90)         share of the capture slots that must be finished (done or failed), rounded up
--   xray_store.left_out_of_pairing        the store's capture was still running when pairing ran; set by each pairing
--   public.xray_pair_quorum               finished, total and required slots, for the blocker and C03
--   public.xray_pair_blocker              'captures', 'neighborhood', 'target' (no finished capture or no menu) or null

insert into public.rule_param (key, value, description) values
  ('m1.pair_min_captures_pct', 90, 'M1-04: share of the capture slots finished (done or failed), rounded up, before pairing may run')
on conflict (key) do nothing;

alter table public.xray_store add column left_out_of_pairing boolean not null default false;
comment on column public.xray_store.left_out_of_pairing is
  'M1-04: the capture of this store had not finished when pairing last ran, so its items took no part. A later capture does not change it; a new pairing does.';

create function public.xray_pair_quorum(p_xray uuid, out finished int, out total int, out required int)
language sql stable security definer set search_path = '' as $$
  select f, t, ceil(t * coalesce((select p.value from public.rule_param p where p.key = 'm1.pair_min_captures_pct'), 90) / 100.0)::int
    from (select count(*) filter (where s.state in ('done', 'failed'))::int as f,
                 count(*) filter (where s.state <> 'beyond_cap')::int as t
            from public.xray_capture_states(p_xray) s) c
$$;
revoke all on function public.xray_pair_quorum(uuid) from public, anon, authenticated;
grant execute on function public.xray_pair_quorum(uuid) to service_role;

create or replace function public.xray_pair_blocker(p_xray uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when (select q.finished < q.required from public.xray_pair_quorum(p_xray) q) then 'captures'
    when exists (select 1 from public.job j
                  where j.type = 'xray_neighborhood' and j.status in ('queued', 'running')
                    and j.payload ->> 'xray_id' = p_xray::text) then 'neighborhood'
    when exists (select 1 from public.xray_capture_states(p_xray) s where s.is_target and s.state <> 'done')
      or not exists (select 1 from public.xray x join public.public_menu_item m on m.public_store_id = x.target_store_id
                      where x.id = p_xray and m.removed_at is null) then 'target'
  end
$$;
