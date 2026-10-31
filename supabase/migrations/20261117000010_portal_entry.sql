-- Owner portal entry (05 §B): sign-up (P07, W06; 04 §7) and invite acceptance (P18; 04 §8).
-- Both run as one transaction each, so a half-made account or a twice-used invite cannot exist.
-- Called only by server code with the service role, after the request was validated (02 §5).

-- P07, W06, 04 §7: account, company, first kitchen, person, membership(dono) and subscription(trial),
-- with trial_ends_at = now + plan.trial_days of Lucro (the trial gets the Lucro defaults, 04 §6).
-- An e-mail or WhatsApp that already belongs to someone creates nothing: the caller answers the same
-- way in both cases (no account enumeration) and the existing person can simply log in.
create function public.portal_sign_up(
  p_name text,
  p_restaurant text,
  p_cnpj text,
  p_email text,
  p_whatsapp text,
  p_xray uuid,
  p_ip inet,
  p_user_agent text,
  p_now timestamptz default now()
) returns table (account_id uuid, person_id uuid, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plan;
  v_account uuid;
  v_company uuid;
  v_kitchen uuid;
  v_person uuid;
  v_code text;
  v_store public.public_store;
  v_store_id uuid;
  v_trial_ends timestamptz;
begin
  if exists (select 1 from public.person p where lower(p.email) = lower(p_email))
     or (p_whatsapp is not null and exists (select 1 from public.person p where p.whatsapp_e164 = p_whatsapp)) then
    return query select null::uuid, null::uuid, false;
    return;
  end if;

  select * into v_plan from public.plan where code = 'lucro';
  v_trial_ends := p_now + make_interval(days => v_plan.trial_days);

  -- Account codes G-01, G-02... (C01). One sign-up at a time picks the next number.
  perform pg_advisory_xact_lock(hashtext('public.portal_sign_up'));
  select 'G-' || lpad((coalesce(max(substring(a.code from '^G-(\d+)$')::int), 0) + 1)::text, 2, '0')
    into v_code from public.account a;

  insert into public.account (name, code, plan_id, trial_ends_at, is_synthetic)
    values (p_restaurant, v_code, v_plan.id, v_trial_ends, false) returning id into v_account;
  insert into public.company (account_id, cnpj, legal_name)
    values (v_account, p_cnpj, p_restaurant) returning id into v_company;
  insert into public.kitchen (account_id, company_id, name, in_analysis)
    values (v_account, v_company, p_restaurant, true) returning id into v_kitchen;
  insert into public.person (name, email, whatsapp_e164)
    values (p_name, lower(p_email), p_whatsapp) returning id into v_person;
  insert into public.membership (account_id, person_id, role, all_kitchens)
    values (v_account, v_person, 'dono', true);
  insert into public.subscription (account_id, plan_id, status, units_billed, last_event, last_event_at)
    values (v_account, v_plan.id, 'trial', 1, 'conta criada', p_now);

  -- P07 ?ref=<xray>: the X-ray's public store becomes the new kitchen's iFood store (P02 link).
  if p_xray is not null then
    select s.* into v_store from public.xray x join public.public_store s on s.id = x.target_store_id
      where x.id = p_xray and x.account_id is null;
    if found then
      update public.xray set account_id = v_account where id = p_xray;
      insert into public.channel_store (account_id, kitchen_id, channel, external_id, name, public_url, source)
        values (v_account, v_kitchen, v_store.channel, v_store.external_id, coalesce(v_store.name, p_restaurant), v_store.url, 'public')
        on conflict (channel, external_id) do nothing
        returning id into v_store_id;
    end if;
  end if;

  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, after, ip, user_agent, at)
  values
    (v_person, 'person', v_account, 'account.sign_up', 'account', v_account,
     jsonb_build_object('code', v_code, 'name', p_restaurant, 'plan', v_plan.code, 'trial_ends_at', v_trial_ends,
                        'company_id', v_company, 'kitchen_id', v_kitchen, 'xray_id', p_xray, 'channel_store_id', v_store_id),
     p_ip, p_user_agent, p_now),
    (v_person, 'person', v_account, 'membership.create', 'membership', null,
     jsonb_build_object('person_id', v_person, 'role', 'dono', 'all_kitchens', true), p_ip, p_user_agent, p_now),
    (v_person, 'person', v_account, 'subscription.trial', 'subscription', null,
     jsonb_build_object('status', 'trial', 'trial_ends_at', v_trial_ends), p_ip, p_user_agent, p_now);

  return query select v_account, v_person, true;
end $$;

comment on function public.portal_sign_up is
  'P07, W06, 04 §7: creates the account in trial. created=false when the e-mail or WhatsApp already has a person.';

-- P18, 04 §8: an invite is valid for 7 days and once. Accepting creates the membership with the role and
-- kitchens of the invite (all kitchens when the invite names none, except for a Gerente, who then sees none).
-- The person is found by the invite's destination (e-mail or WhatsApp) or created with the given name.
-- For a WhatsApp invite, p_email is the login e-mail the person chose (codes go by e-mail until D36).
-- status: ok | invalid (unknown, expired or used) | email_taken | already_member.
create function public.portal_accept_invite(
  p_token_hash text,
  p_name text,
  p_email text,
  p_ip inet,
  p_user_agent text,
  p_now timestamptz default now()
) returns table (status text, person_id uuid, account_id uuid, email text)
language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.invite;
  v_person public.person;
  v_email text;
  v_membership uuid;
  v_created boolean := false;
begin
  select * into v_invite from public.invite i where i.token_hash = p_token_hash for update;
  if not found or v_invite.accepted_at is not null or v_invite.expires_at <= p_now then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_invite.channel = 'email' then
    v_email := lower(v_invite.destination);
    select * into v_person from public.person p where lower(p.email) = v_email;
  else
    v_email := lower(nullif(trim(p_email), ''));
    select * into v_person from public.person p where p.whatsapp_e164 = v_invite.destination;
    if found and v_person.email is not null then
      v_email := lower(v_person.email);
    elsif v_email is null or exists (select 1 from public.person p where lower(p.email) = v_email
                                      and p.id is distinct from v_person.id) then
      return query select 'email_taken'::text, null::uuid, null::uuid, null::text;
      return;
    end if;
  end if;

  if v_person.id is null then
    insert into public.person (name, email, whatsapp_e164)
      values (p_name, v_email, case when v_invite.channel = 'whatsapp' then v_invite.destination end)
      returning * into v_person;
    v_created := true;
  elsif v_person.email is null then
    update public.person set email = v_email where id = v_person.id returning * into v_person;
  end if;

  if exists (select 1 from public.membership m where m.account_id = v_invite.account_id and m.person_id = v_person.id) then
    return query select 'already_member'::text, null::uuid, null::uuid, null::text;
    return;
  end if;

  insert into public.membership (account_id, person_id, role, all_kitchens)
    values (v_invite.account_id, v_person.id, v_invite.role,
            cardinality(v_invite.kitchen_ids) = 0 and v_invite.role <> 'gerente')
    returning id into v_membership;
  insert into public.membership_kitchen (membership_id, kitchen_id)
    select v_membership, k.id from public.kitchen k
    where k.account_id = v_invite.account_id and k.id = any (v_invite.kitchen_ids);
  update public.invite set accepted_at = p_now where id = v_invite.id;

  insert into public.audit_log (actor_person_id, actor_kind, account_id, action, entity, entity_id, before, after, ip, user_agent, at)
  values
    (v_person.id, 'person', v_invite.account_id, 'invite.accept', 'invite', v_invite.id,
     jsonb_build_object('accepted_at', null), jsonb_build_object('accepted_at', p_now, 'person_created', v_created),
     p_ip, p_user_agent, p_now),
    (v_person.id, 'person', v_invite.account_id, 'membership.create', 'membership', v_membership, null,
     jsonb_build_object('person_id', v_person.id, 'name', v_person.name, 'role', v_invite.role, 'kitchen_ids', v_invite.kitchen_ids,
                        'invited_by', v_invite.invited_by),
     p_ip, p_user_agent, p_now);

  return query select 'ok'::text, v_person.id, v_invite.account_id, v_person.email;
end $$;

comment on function public.portal_accept_invite is
  'P18, 04 §8: single-use 7-day invite to membership. status ok | invalid | email_taken | already_member.';

revoke all on function public.portal_sign_up from public, anon, authenticated;
revoke all on function public.portal_accept_invite from public, anon, authenticated;
grant execute on function public.portal_sign_up to service_role;
grant execute on function public.portal_accept_invite to service_role;
