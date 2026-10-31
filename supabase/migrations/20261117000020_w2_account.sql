-- Wave 2, owner account screens (05 P13/W02, P14/W04, P03/W07; 04 §5, §8; E04, E06, C06).
--
-- People changes go through the functions below, called by audited server actions with the service role
-- after their own permission check (02 §5), as public.contestation_mark does for contestations. Each one
-- re-checks that the actor is a Dono of the account, refuses during a security_lock (E04, D35) and
-- writes audit_log in the same transaction as the change. app.ensure_dono stays the backstop for the
-- last Dono; the explicit check here gives the screen a clear reason.
--
-- Errors carry a stable key in the message (E04_locked, E04_last_dono, not_dono, ...) that the web app
-- maps to the copy on screen.

-- P03/W07: which version of the terms the Dono accepted for the CNPJ (D48) -------------------------

alter table public.owner_authorization add column terms_version text;
comment on column public.owner_authorization.terms_version is
  'Version of docs/legal/autorizacao-dados.md accepted in P03/W07 (D48). Null for rows signed on paper.';

-- W04: the name the Dono gives the invited person ("Contador"); P18 asks the invitee for their own --

alter table public.invite add column name text;

-- E06: data export zips, private, read only through the portal route after a Dono check ------------

insert into storage.buckets (id, name, public) values ('exports', 'exports', false)
  on conflict (id) do nothing;

-- E04: 24-hour lock after a contact change (04 §8, D35) -------------------------------------------

create function public.people_lock_until(p_account uuid, p_at timestamptz default now())
returns timestamptz
language sql stable set search_path = '' as $$
  select max(l.until) from public.security_lock l where l.account_id = p_account and l.until > p_at
$$;
comment on function public.people_lock_until is
  'E04: end of the active security_lock of the account, null when plan and people changes are open.';

-- W09 "Trocar" calls this after the code on the new channel is confirmed: one lock per account of the
-- person, 24 hours from the change.
create function public.security_lock_contact_change(
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
    insert into public.security_lock (account_id, reason, until)
    values (m.account_id, 'contact_change:' || p_channel::text, p_at + interval '24 hours')
    returning * into l;
    insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, after, ip, user_agent, at)
    values (p_person, 'person', m.account_id, 'security_lock.contact_change', 'security_lock', l.id,
            jsonb_build_object('channel', p_channel, 'until', l.until), p_ip, p_user_agent, p_at);
    return next l;
  end loop;
end $$;

-- Shared guard: the actor is a Dono of the account and no lock is active.
create function app.people_guard(p_actor uuid, p_account uuid, p_at timestamptz) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not exists (
    select 1 from public.membership m where m.account_id = p_account and m.person_id = p_actor and m.role = 'dono'
  ) then
    raise exception 'not_dono: only a Dono changes people (04 §5)' using errcode = 'insufficient_privilege';
  end if;
  if public.people_lock_until(p_account, p_at) is not null then
    raise exception 'E04_locked: people changes are locked after a contact change (04 §8)'
      using errcode = 'lock_not_available';
  end if;
end $$;

create function app.kitchens_of_account(p_account uuid, p_kitchens uuid[]) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(bool_and(exists (
    select 1 from public.kitchen k where k.id = x and k.account_id = p_account
  )), true) from unnest(coalesce(p_kitchens, '{}')) as x
$$;

-- W04: change profile and kitchen scope. A Dono always sees every kitchen (P14 "Dono: tudo").
create function public.membership_update(
  p_actor uuid,
  p_membership uuid,
  p_role public.member_role,
  p_all_kitchens boolean,
  p_kitchens uuid[] default '{}',
  p_at timestamptz default now(),
  p_ip inet default null,
  p_user_agent text default null
) returns public.membership
language plpgsql set search_path = '' as $$
declare
  m public.membership;
  after_row public.membership;
  before_kitchens uuid[];
  all_k boolean := p_all_kitchens or p_role = 'dono';
  ks uuid[] := case when p_all_kitchens or p_role = 'dono' then '{}'::uuid[] else coalesce(p_kitchens, '{}') end;
begin
  select * into m from public.membership where id = p_membership for update;
  if not found then
    raise exception 'membership % not found', p_membership using errcode = 'no_data_found';
  end if;
  perform app.people_guard(p_actor, m.account_id, p_at);
  if m.role = 'dono' and p_role <> 'dono' and (
    select count(*) from public.membership x where x.account_id = m.account_id and x.role = 'dono'
  ) = 1 then
    raise exception 'E04_last_dono: the account must keep one Dono' using errcode = 'check_violation';
  end if;
  if not all_k and cardinality(ks) = 0 then
    raise exception 'no_kitchen: choose at least one kitchen' using errcode = 'check_violation';
  end if;
  if not app.kitchens_of_account(m.account_id, ks) then
    raise exception 'kitchen_not_in_account' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(kitchen_id order by kitchen_id), '{}') into before_kitchens
    from public.membership_kitchen where membership_id = m.id;
  update public.membership set role = p_role, all_kitchens = all_k where id = m.id returning * into after_row;
  delete from public.membership_kitchen where membership_id = m.id;
  insert into public.membership_kitchen (membership_id, kitchen_id) select m.id, k from unnest(ks) as k;

  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, before, after, ip, user_agent, at)
  values (p_actor, 'person', m.account_id, 'membership.update', 'membership', m.id,
          jsonb_build_object('role', m.role, 'all_kitchens', m.all_kitchens, 'kitchen_ids', before_kitchens),
          jsonb_build_object('role', after_row.role, 'all_kitchens', after_row.all_kitchens, 'kitchen_ids', ks),
          p_ip, p_user_agent, p_at);
  return after_row;
end $$;

-- W04 "Remover". The person loses the account; their extension tokens for it are revoked.
create function public.membership_remove(
  p_actor uuid,
  p_membership uuid,
  p_at timestamptz default now(),
  p_ip inet default null,
  p_user_agent text default null
) returns void
language plpgsql set search_path = '' as $$
declare
  m public.membership;
begin
  select * into m from public.membership where id = p_membership for update;
  if not found then
    raise exception 'membership % not found', p_membership using errcode = 'no_data_found';
  end if;
  perform app.people_guard(p_actor, m.account_id, p_at);
  if m.role = 'dono' and (
    select count(*) from public.membership x where x.account_id = m.account_id and x.role = 'dono'
  ) = 1 then
    raise exception 'E04_last_dono: the account must keep one Dono' using errcode = 'check_violation';
  end if;

  delete from public.membership where id = m.id;
  update public.extension_token set revoked_at = p_at
   where account_id = m.account_id and person_id = m.person_id and revoked_at is null;

  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, before, ip, user_agent, at)
  values (p_actor, 'person', m.account_id, 'membership.remove', 'membership', m.id,
          jsonb_build_object('person_id', m.person_id, 'role', m.role, 'all_kitchens', m.all_kitchens),
          p_ip, p_user_agent, p_at);
end $$;

-- W04, P14 "Convidar pessoa": 7 days, single use (04 §8, P18). Only the token hash is stored.
create function public.invite_create(
  p_actor uuid,
  p_account uuid,
  p_name text,
  p_role public.member_role,
  p_kitchens uuid[],
  p_channel public.contact_channel,
  p_destination text,
  p_token_hash text,
  p_at timestamptz default now(),
  p_ip inet default null,
  p_user_agent text default null
) returns public.invite
language plpgsql set search_path = '' as $$
declare
  ks uuid[] := case when p_role = 'dono' then '{}'::uuid[] else coalesce(p_kitchens, '{}') end;
  i public.invite;
begin
  perform app.people_guard(p_actor, p_account, p_at);
  if not app.kitchens_of_account(p_account, ks) then
    raise exception 'kitchen_not_in_account' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.membership m join public.person p on p.id = m.person_id
    where m.account_id = p_account
      and ((p_channel = 'email' and lower(p.email) = lower(p_destination))
        or (p_channel = 'whatsapp' and p.whatsapp_e164 = p_destination))
  ) then
    raise exception 'already_member: this contact already has access' using errcode = 'unique_violation';
  end if;

  insert into public.invite (account_id, name, role, kitchen_ids, channel, destination, token_hash, expires_at, invited_by, created_at)
  values (p_account, nullif(trim(p_name), ''), p_role, ks, p_channel, p_destination, p_token_hash,
          p_at + interval '7 days', p_actor, p_at)
  returning * into i;

  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, after, ip, user_agent, at)
  values (p_actor, 'person', p_account, 'invite.create', 'invite', i.id,
          jsonb_build_object('role', i.role, 'name', i.name, 'channel', i.channel, 'kitchen_ids', i.kitchen_ids),
          p_ip, p_user_agent, p_at);
  return i;
end $$;

-- W04 "Reenviar convite": a new token and 7 more days; the old link stops working.
create function public.invite_resend(
  p_actor uuid,
  p_invite uuid,
  p_token_hash text,
  p_at timestamptz default now(),
  p_ip inet default null,
  p_user_agent text default null
) returns public.invite
language plpgsql set search_path = '' as $$
declare
  i public.invite;
  after_row public.invite;
begin
  select * into i from public.invite where id = p_invite for update;
  if not found then
    raise exception 'invite % not found', p_invite using errcode = 'no_data_found';
  end if;
  perform app.people_guard(p_actor, i.account_id, p_at);
  if i.accepted_at is not null then
    raise exception 'invite_used: the invite was already accepted' using errcode = 'check_violation';
  end if;
  update public.invite set token_hash = p_token_hash, expires_at = p_at + interval '7 days'
   where id = i.id returning * into after_row;
  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, before, after, ip, user_agent, at)
  values (p_actor, 'person', i.account_id, 'invite.resend', 'invite', i.id,
          jsonb_build_object('expires_at', i.expires_at), jsonb_build_object('expires_at', after_row.expires_at),
          p_ip, p_user_agent, p_at);
  return after_row;
end $$;

revoke all on function public.people_lock_until(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.security_lock_contact_change(uuid, public.contact_channel, timestamptz, inet, text) from public, anon, authenticated;
revoke all on function public.membership_update(uuid, uuid, public.member_role, boolean, uuid[], timestamptz, inet, text) from public, anon, authenticated;
revoke all on function public.membership_remove(uuid, uuid, timestamptz, inet, text) from public, anon, authenticated;
revoke all on function public.invite_create(uuid, uuid, text, public.member_role, uuid[], public.contact_channel, text, text, timestamptz, inet, text) from public, anon, authenticated;
revoke all on function public.invite_resend(uuid, uuid, text, timestamptz, inet, text) from public, anon, authenticated;
grant execute on function public.people_lock_until(uuid, timestamptz) to service_role;
grant execute on function public.security_lock_contact_change(uuid, public.contact_channel, timestamptz, inet, text) to service_role;
grant execute on function public.membership_update(uuid, uuid, public.member_role, boolean, uuid[], timestamptz, inet, text) to service_role;
grant execute on function public.membership_remove(uuid, uuid, timestamptz, inet, text) to service_role;
grant execute on function public.invite_create(uuid, uuid, text, public.member_role, uuid[], public.contact_channel, text, text, timestamptz, inet, text) to service_role;
grant execute on function public.invite_resend(uuid, uuid, text, timestamptz, inet, text) to service_role;
revoke all on function app.people_guard(uuid, uuid, timestamptz) from public;
revoke all on function app.kitchens_of_account(uuid, uuid[]) from public;
grant execute on function app.people_guard(uuid, uuid, timestamptz) to service_role;
grant execute on function app.kitchens_of_account(uuid, uuid[]) to service_role;
