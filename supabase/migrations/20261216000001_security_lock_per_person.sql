-- 04 §8, E04 (Marlon, 01/nov): the 24-hour security_lock after a login contact change holds back only
-- the person who changed it, not the whole account. A Financeiro or Gerente who changes their e-mail no
-- longer blocks the Dono; a Dono who changes theirs is the one locked, as before.
--
-- security_lock gets the person. Rows written before this migration are attributed through their audit
-- row (security_lock.contact_change); a row without a person still locks the whole account.

alter table public.security_lock
  add column person_id uuid references public.person (id) on delete cascade;
comment on column public.security_lock.person_id is
  'Person held back by the lock (04 §8). Null only on rows that lock the whole account.';
comment on table public.security_lock is
  '24-hour lock on plan and people changes for the person who changed a login contact (D35, 04 §8).';
create index security_lock_account_person on public.security_lock (account_id, person_id, until);

update public.security_lock l set person_id = a.actor_person_id
  from public.audit_log a
 where a.action = 'security_lock.contact_change' and a.entity = 'security_lock' and a.entity_id = l.id
   and l.person_id is null and a.actor_person_id is not null;

-- E04: end of the active lock for this person in this account, null when they may change plan and people.
drop function public.people_lock_until(uuid, timestamptz);
create function public.people_lock_until(p_account uuid, p_person uuid, p_at timestamptz default now())
returns timestamptz
language sql stable set search_path = '' as $$
  select max(l.until) from public.security_lock l
   where l.account_id = p_account and l.until > p_at and (l.person_id is null or l.person_id = p_person)
$$;
comment on function public.people_lock_until is
  'E04, 04 §8: end of the active security_lock of the person in the account, null when their plan and people changes are open.';

-- W09 "Trocar": one lock per account of the person, 24 hours from the change, on that person only.
create or replace function public.security_lock_contact_change(
  p_person uuid,
  p_channel public.contact_channel,
  p_at timestamptz default now(),
  p_ip inet default null,
  p_user_agent text default null
) returns setof public.security_lock
language plpgsql set search_path = '' as $$
declare
  m record;
  l public.security_lock;
begin
  for m in select account_id from public.membership where person_id = p_person loop
    insert into public.security_lock (account_id, person_id, reason, until)
    values (m.account_id, p_person, 'contact_change:' || p_channel::text, p_at + interval '24 hours')
    returning * into l;
    insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, after, ip, user_agent, at)
    values (p_person, 'person', m.account_id, 'security_lock.contact_change', 'security_lock', l.id,
            jsonb_build_object('channel', p_channel, 'until', l.until), p_ip, p_user_agent, p_at);
    return next l;
  end loop;
end $$;

-- Shared guard: the actor is a Dono of the account and the actor's own lock is not active.
create or replace function app.people_guard(p_actor uuid, p_account uuid, p_at timestamptz) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not exists (
    select 1 from public.membership m where m.account_id = p_account and m.person_id = p_actor and m.role = 'dono'
  ) then
    raise exception 'not_dono: only a Dono changes people (04 §5)' using errcode = 'insufficient_privilege';
  end if;
  if public.people_lock_until(p_account, p_actor, p_at) is not null then
    raise exception 'E04_locked: your people changes are locked after you changed a login contact (04 §8)'
      using errcode = 'lock_not_available';
  end if;
end $$;

revoke all on function public.people_lock_until(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.people_lock_until(uuid, uuid, timestamptz) to service_role;
