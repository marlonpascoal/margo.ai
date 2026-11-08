-- M1 "Vou testar" (Marlon, 08/nov): on P23 the owner marks up to m1.test_max_items items of an own-store monitoring to
-- test until the next run (change a price on iFood, see on the next X-ray what happened). The X-ray stops being an end
-- point: the next run answers the test.
--
--   monitor_test_item          an item (public_menu_item id, stable across runs) marked in a monitoring, with the run it
--                              was marked on (from_xray_id); unmarking sets removed_at, the row stays (history)
--   monitor_test_mark, _unmark the audited writes (A04). Who: as app.monitor_answerer (Dono; the Gerente of the
--                              monitoring's kitchen while m1.portal_gerente_answers is 1; staff for support). Financeiro
--                              only sees. Own-store monitorings only: a competitor's price is not the owner's to change.
--   monitor_test_plan          loader of P23 "Seus testes" (service role, after the portal's RLS read of the run): per
--                              active test, own price, M1-05 middle, M1-07 reading and the item's M1-10 position on the
--                              run where it was marked and on the run shown, so the screen says what changed
--
-- Refusals (P0001 unless noted):
--   monitor_not_allowed (42501)   the actor may not answer for this monitoring
--   monitor_removed               the monitoring was removed
--   monitor_test_own_only         a competitor monitoring
--   monitor_test_bad_item         the run is not of this monitoring, or the item is not in that run
--   monitor_test_limit:<n>        n items are marked already (m1.test_max_items)

insert into public.rule_param (key, value, description) values
  ('m1.test_max_items', 3, 'P23 "Vou testar": items marked at once per monitoring');

create table public.monitor_test_item (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null,
  account_id uuid not null references public.account (id) on delete cascade,
  public_menu_item_id uuid not null references public.public_menu_item (id),
  from_xray_id uuid not null references public.xray (id) on delete cascade,
  marked_by uuid references public.person (id) on delete set null,
  marked_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, monitor_id) references public.xray_monitor (account_id, id) on delete cascade
);
comment on table public.monitor_test_item is
  'P23 "Vou testar": an own item the owner tests until the next run of the monitoring. Unmarked rows keep removed_at.';
comment on column public.monitor_test_item.from_xray_id is 'The run on which the item was marked: the "before" of the test.';
create unique index monitor_test_item_active on public.monitor_test_item (monitor_id, public_menu_item_id) where removed_at is null;
create index monitor_test_item_monitor on public.monitor_test_item (monitor_id, marked_at);

create trigger set_updated_at before update on public.monitor_test_item
  for each row execute function app.set_updated_at();
alter table public.monitor_test_item enable row level security;
-- As monitor_pair_decision: whoever sees the monitoring (04 §5 "See price X-ray"). No write policy.
create policy read on public.monitor_test_item for select to authenticated
  using (app.is_staff() or app.sees_monitor(monitor_id));

-- The run of p_xray must be of the monitoring and hold the own item; returns the monitoring locked, after the person check.
create function app.monitor_test_check(p_monitor uuid, p_item uuid, p_xray uuid, p_actor uuid, out m public.xray_monitor,
                                       out who public.actor_kind)
language plpgsql security definer set search_path = '' as $$
begin
  m := app.monitor_row(p_monitor);
  who := app.monitor_answerer(m, p_actor);
  if m.status = 'removed' then
    raise exception 'monitor_removed';
  end if;
  if m.target_kind <> 'own' then
    raise exception 'monitor_test_own_only';
  end if;
  if p_xray is not null and not exists (
       select 1 from public.xray x join public.xray_item i on i.xray_id = x.id
        where x.id = p_xray and x.monitor_id = p_monitor and i.public_menu_item_id = p_item) then
    raise exception 'monitor_test_bad_item';
  end if;
end $$;

-- P23 "Vou testar": marks the own item (public_menu_item id) seen on run p_xray. Marking an item already marked returns
-- the same row and writes nothing. Returns the monitor_test_item id.
create function public.monitor_test_mark(
  p_monitor uuid, p_item uuid, p_xray uuid, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  lim int := app.monitor_param('m1.test_max_items', 3)::int;
  existing uuid;
  tid uuid;
begin
  if p_xray is null then
    raise exception 'monitor_test_bad_item';
  end if;
  select * into c from app.monitor_test_check(p_monitor, p_item, p_xray, p_actor);
  select t.id into existing from public.monitor_test_item t
   where t.monitor_id = p_monitor and t.public_menu_item_id = p_item and t.removed_at is null;
  if existing is not null then
    return existing;
  end if;
  if (select count(*) from public.monitor_test_item t where t.monitor_id = p_monitor and t.removed_at is null) >= lim then
    raise exception 'monitor_test_limit:%', lim;
  end if;
  insert into public.monitor_test_item (monitor_id, account_id, public_menu_item_id, from_xray_id, marked_by, marked_at)
  values (p_monitor, (c.m).account_id, p_item, p_xray, p_actor, clock_timestamp())
  returning id into tid;
  perform app.monitor_audit(p_actor, c.who, (c.m).account_id, 'monitor.test_mark', 'monitor_test_item', tid, null,
    jsonb_build_object('monitor_id', p_monitor, 'public_menu_item_id', p_item, 'from_xray_id', p_xray), p_ip, p_user_agent);
  return tid;
end $$;

-- "Testando · Desfazer": unmarks the own item. Nothing marked: nothing written, returns null.
create function public.monitor_test_unmark(
  p_monitor uuid, p_item uuid, p_actor uuid, p_ip inet default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  t public.monitor_test_item;
begin
  select * into c from app.monitor_test_check(p_monitor, p_item, null, p_actor);
  select * into t from public.monitor_test_item x
   where x.monitor_id = p_monitor and x.public_menu_item_id = p_item and x.removed_at is null for update;
  if not found then
    return null;
  end if;
  update public.monitor_test_item set removed_at = now(), removed_by = p_actor where id = t.id;
  perform app.monitor_audit(p_actor, c.who, (c.m).account_id, 'monitor.test_unmark', 'monitor_test_item', t.id,
    jsonb_build_object('monitor_id', p_monitor, 'public_menu_item_id', p_item, 'from_xray_id', t.from_xray_id, 'removed', false),
    jsonb_build_object('monitor_id', p_monitor, 'public_menu_item_id', p_item, 'from_xray_id', t.from_xray_id, 'removed', true),
    p_ip, p_user_agent);
  return t.id;
end $$;

-- One own item on one run: own price (xray_item_view: the run's snapshot, else the catalog), M1-05 middle, M1-06 gap, M1-07 reading
-- (null when the item was left out of the calculation) and its M1-10 position among the stores selling it.
create function app.monitor_test_point(p_xray uuid, p_item uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'xray_id', x.id, 'on', (x.collected_at at time zone 'America/Sao_Paulo')::date,
    'item_id', i.id,
    'own_cents', v.own_cents,
    'parity_cents', case when not i.skipped then i.parity_cents end,
    'gap_pct', case when not i.skipped then i.gap_pct end,
    'reading', case when not i.skipped then i.reading end,
    'rank', ps.rank, 'stores', ps.stores)
    from public.xray x
    join public.xray_item i on i.xray_id = x.id and i.public_menu_item_id = p_item
    join public.xray_item_view v on v.id = i.id
    left join public.xray_item_position ps on ps.xray_id = x.id and ps.xray_item_id = i.id
   where x.id = p_xray
   limit 1
$$;

-- P23 "Seus testes" for the run p_xray: the monitoring's active tests, oldest first, each with the run where it was marked
-- ("then") and this run ("now", null when the item is not in it); plus the run's own items (xray_item id to own item id)
-- for the "Vou testar" buttons. Null for a run without a monitoring.
create function public.monitor_test_plan(p_xray uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (select v.* from public.xray v where v.id = p_xray and v.monitor_id is not null),
  m as (select mm.* from public.xray_monitor mm join x on x.monitor_id = mm.id),
  t as (
    select ti.*, fx.created_at as from_created_at from public.monitor_test_item ti
      join m on m.id = ti.monitor_id join public.xray fx on fx.id = ti.from_xray_id
     where ti.removed_at is null
  )
  select jsonb_build_object(
    'xray_id', x.id, 'monitor_id', x.monitor_id, 'target_kind', m.target_kind,
    'max_items', app.monitor_param('m1.test_max_items', 3)::int,
    'active', (select count(*) from t),
    'own_item_ids', (select coalesce(jsonb_object_agg(i.id, i.public_menu_item_id), '{}')
                       from public.xray_item i where i.xray_id = x.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'test_id', t.id, 'own_item_id', t.public_menu_item_id,
        'name', (select pm.name from public.public_menu_item pm where pm.id = t.public_menu_item_id),
        'marked_at', t.marked_at, 'marked_on', (t.marked_at at time zone 'America/Sao_Paulo')::date,
        'marked_by', (select pe.name from public.person pe where pe.id = t.marked_by),
        'from_xray_id', t.from_xray_id,
        'same_run', t.from_xray_id = x.id,
        'then', app.monitor_test_point(t.from_xray_id, t.public_menu_item_id),
        'now', app.monitor_test_point(x.id, t.public_menu_item_id))
        order by t.marked_at, t.id), '[]') from t)
  ) from x join m on true
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.monitor_test_check(uuid, uuid, uuid, uuid)',
    'app.monitor_test_point(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.monitor_test_mark(uuid, uuid, uuid, uuid, inet, text)',
    'public.monitor_test_unmark(uuid, uuid, uuid, inet, text)',
    'public.monitor_test_plan(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
