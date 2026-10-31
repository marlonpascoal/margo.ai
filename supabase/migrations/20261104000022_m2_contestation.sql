-- Contestation status (04 §3, D30, C04). The transition table lives here, so no path can skip it:
-- a status change is accepted only through public.contestation_mark, which checks the table, stamps
-- who marked it and writes audit_log. workers/import/src/margo_import/contestation.py mirrors the
-- table for the worker and its unit test (test_C04_contestation_transitions).
--
--   a_contestar      --(person: ja_contestei, protocol optional)--> contestada
--   precisa_resposta --(person: foi_combinado_sim)--> closed (no difference): closed_at set
--   precisa_resposta --(person: foi_combinado_nao)--> a_contestar
--   contestada       --(system: credito_encontrado)--> creditada
--   contestada       --(person or staff: foi_negada)--> negada
--   a_contestar      --(system: prazo_passou)--> prazo_vencido

create function app.contestation_next(
  p_status public.contestation_status, p_event text, p_actor public.actor_kind
) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_status = 'a_contestar' and p_event = 'ja_contestei' and p_actor = 'person' then 'contestada'
    when p_status = 'precisa_resposta' and p_event = 'foi_combinado_sim' and p_actor = 'person' then 'encerrada'
    when p_status = 'precisa_resposta' and p_event = 'foi_combinado_nao' and p_actor = 'person' then 'a_contestar'
    when p_status = 'contestada' and p_event = 'credito_encontrado' and p_actor = 'system' then 'creditada'
    when p_status = 'contestada' and p_event = 'foi_negada' and p_actor in ('person', 'staff') then 'negada'
    when p_status = 'a_contestar' and p_event = 'prazo_passou' and p_actor = 'system' then 'prazo_vencido'
  end
$$;
comment on function app.contestation_next is
  'C04: next status for (status, event, actor), ''encerrada'' for closed, null when the transition is not allowed.';

-- Starting status (04 §3): certa starts a_contestar, provavel precisa_resposta; duvidosa has none.
create function app.contestation_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('a_contestar', 'precisa_resposta') or new.closed_at is not null then
      raise exception 'a contestation starts as a_contestar or precisa_resposta, not %', new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.status is distinct from old.status or new.closed_at is distinct from old.closed_at)
     and coalesce(current_setting('app.contestation_mark', true), '') <> 'on' then
    raise exception 'contestation status changes only through public.contestation_mark (04 §3)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger contestation_guard before insert or update on public.contestation
  for each row execute function app.contestation_guard();

-- The one way to move a contestation. Called by server actions and the worker with the service role,
-- after their own permission check (02 §5). p_at lets the seed replay drawn history.
create function public.contestation_mark(
  p_contestation uuid,
  p_event text,
  p_actor_kind public.actor_kind,
  p_actor uuid default null,
  p_protocol text default null,
  p_credited_entry uuid default null,
  p_at timestamptz default now(),
  p_ip inet default null,
  p_user_agent text default null
) returns public.contestation
language plpgsql set search_path = '' as $$
declare
  c public.contestation;
  after_row public.contestation;
  nxt text;
begin
  select * into c from public.contestation where id = p_contestation for update;
  if not found then
    raise exception 'contestation % not found', p_contestation using errcode = 'no_data_found';
  end if;
  if c.closed_at is not null then
    raise exception 'contestation % is closed', p_contestation using errcode = 'check_violation';
  end if;
  nxt := app.contestation_next(c.status, p_event, p_actor_kind);
  if nxt is null then
    raise exception 'transition % from % by % is not allowed (04 §3)', p_event, c.status, p_actor_kind
      using errcode = 'check_violation';
  end if;
  if p_actor_kind <> 'system' and p_actor is null then
    raise exception 'a person or staff transition needs the actor' using errcode = 'invalid_parameter_value';
  end if;
  if nxt = 'creditada' and p_credited_entry is null then
    raise exception 'creditada needs the matching ledger entry' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('app.contestation_mark', 'on', true);
  update public.contestation set
    status = case when nxt = 'encerrada' then status else nxt::public.contestation_status end,
    closed_at = case when nxt = 'encerrada' then p_at else closed_at end,
    protocol = case when p_event = 'ja_contestei' then coalesce(nullif(trim(p_protocol), ''), protocol) else protocol end,
    credited_entry_id = coalesce(p_credited_entry, credited_entry_id),
    marked_by = case when p_actor_kind = 'system' then null else p_actor end,
    marked_by_kind = p_actor_kind,
    marked_at = p_at
  where id = p_contestation
  returning * into after_row;
  perform set_config('app.contestation_mark', 'off', true);

  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, before, after, ip, user_agent, at)
  values (p_actor, p_actor_kind, c.account_id, 'contestation.' || p_event, 'contestation', c.id,
          jsonb_build_object('status', c.status),
          jsonb_build_object('status', after_row.status, 'closed', after_row.closed_at is not null,
                             'protocol', after_row.protocol, 'credited_entry_id', after_row.credited_entry_id),
          p_ip, p_user_agent, p_at);
  return after_row;
end $$;

revoke all on function public.contestation_mark from public, anon, authenticated;
grant execute on function public.contestation_mark to service_role;
revoke all on function app.contestation_next from public;
grant execute on function app.contestation_next to anon, authenticated, service_role;
