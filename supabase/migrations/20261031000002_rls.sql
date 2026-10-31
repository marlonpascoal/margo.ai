-- Row level security (02 §5, 04 §5).
--
-- Portal users (authenticated, with a membership) and console users (authenticated, with a staff row)
-- get SELECT policies only. Every write goes through a server action that checks permissions in
-- apps/web/lib/permissions.ts, writes audit_log and uses the service role. No policy grants
-- INSERT, UPDATE or DELETE, so direct writes from a browser session are refused.

-- Helpers (schema app is not exposed by the API) --------------------------------------------------

create function app.person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.person p where p.auth_user_id = (select auth.uid())
$$;

create function app.is_member(p_account uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membership m
    where m.account_id = p_account and m.person_id = app.person_id()
  )
$$;

create function app.is_dono(p_account uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membership m
    where m.account_id = p_account and m.person_id = app.person_id() and m.role = 'dono'
  )
$$;

-- A03: all kitchens, or the chosen ones. A store without kitchen is visible only with all_kitchens.
create function app.sees_kitchen(p_account uuid, p_kitchen uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membership m
    where m.account_id = p_account and m.person_id = app.person_id()
      and (m.all_kitchens or exists (
        select 1 from public.membership_kitchen mk
        where mk.membership_id = m.id and mk.kitchen_id = p_kitchen
      ))
  )
$$;

create function app.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.person_id = app.person_id())
$$;

create function app.is_fundador() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.person_id = app.person_id() and s.role = 'fundador')
$$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to anon, authenticated, service_role;

-- Enable RLS everywhere ---------------------------------------------------------------------------

do $$
declare t text;
begin
  for t in select table_name from information_schema.tables
           where table_schema = 'public' and table_type = 'BASE TABLE' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Read policies -----------------------------------------------------------------------------------

-- Account-wide data: members and staff.
create policy read on public.account for select to authenticated
  using (app.is_member(id) or app.is_staff());
create policy read on public.company for select to authenticated
  using (app.is_member(account_id) or app.is_staff());
create policy read on public.brand for select to authenticated
  using (app.is_member(account_id) or app.is_staff());
create policy read on public.security_lock for select to authenticated
  using (app.is_member(account_id) or app.is_staff());
create policy read on public.owner_authorization for select to authenticated
  using (app.is_member(account_id) or app.is_staff());

-- Kitchen-scoped data (A03).
create policy read on public.kitchen for select to authenticated
  using (app.sees_kitchen(account_id, id) or app.is_staff());
create policy read on public.channel_store for select to authenticated
  using (app.sees_kitchen(account_id, kitchen_id) or app.is_staff());
create policy read on public.channel_store_url_history for select to authenticated
  using (exists (select 1 from public.channel_store cs where cs.id = channel_store_id));

-- People: self; the Dono sees the account's people (P14, others see only themselves).
create policy read on public.person for select to authenticated
  using (
    id = app.person_id() or app.is_staff()
    or exists (select 1 from public.membership m where m.person_id = person.id and app.is_dono(m.account_id))
  );
create policy read on public.membership for select to authenticated
  using (person_id = app.person_id() or app.is_dono(account_id) or app.is_staff());
create policy read on public.membership_kitchen for select to authenticated
  using (exists (select 1 from public.membership m where m.id = membership_id));
create policy read on public.invite for select to authenticated
  using (app.is_dono(account_id) or app.is_staff());
create policy read on public.staff for select to authenticated
  using (app.is_staff());

-- Own rows only.
create policy read on public.session_device for select to authenticated
  using (person_id = app.person_id());
create policy read on public.notice_pref for select to authenticated
  using (person_id = app.person_id());
create policy read on public.extension_token for select to authenticated
  using (person_id = app.person_id());
create policy read on public.notification for select to authenticated
  using (person_id = app.person_id() or app.is_staff());

-- Reference data, public (P07 shows the trial length before login).
create policy read on public.plan for select to anon, authenticated using (true);
create policy read on public.notice_type for select to anon, authenticated using (true);

-- Billing: the Dono sees the subscription; the rest is Fundador only (04 §5).
create policy read on public.subscription for select to authenticated
  using (app.is_dono(account_id) or app.is_fundador());
create policy read on public.billing_event for select to authenticated using (app.is_fundador());
create policy read on public.pilot for select to authenticated using (app.is_fundador());
create policy read on public.pilot_charge for select to authenticated using (app.is_fundador());

-- Console.
create policy read on public.bpo_partner for select to authenticated using (app.is_staff());
create policy read on public.bpo_client for select to authenticated using (app.is_staff());
create policy read on public.feature_flag for select to authenticated using (app.is_fundador());
create policy read on public.feature_override for select to authenticated using (app.is_fundador());
create policy read on public.feature_flag_log for select to authenticated using (app.is_fundador());
create policy read on public.alert for select to authenticated using (app.is_staff());
create policy read on public.job for select to authenticated using (app.is_staff());

-- Access log (W09) for the Dono; everything for staff.
create policy read on public.audit_log for select to authenticated
  using (app.is_staff() or (account_id is not null and app.is_dono(account_id)));

-- Integrity triggers ------------------------------------------------------------------------------

-- E04: an account always keeps at least one Dono. Deferred so sign-up and swaps can run in one transaction.
create function app.ensure_dono() returns trigger
language plpgsql security definer set search_path = '' as $$
declare acc uuid := coalesce(old.account_id, new.account_id);
begin
  if exists (select 1 from public.account a where a.id = acc)
     and not exists (select 1 from public.membership m where m.account_id = acc and m.role = 'dono') then
    raise exception 'account % must keep at least one dono', acc using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger membership_keeps_dono
  after insert or update or delete on public.membership
  deferrable initially deferred
  for each row execute function app.ensure_dono();

-- A04: audit rows are never changed; only the deletion job (02 §7) may delete them.
create function app.audit_log_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.deletion_job', true) = 'on' then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end $$;

create trigger append_only before update or delete on public.audit_log
  for each row execute function app.audit_log_append_only();

-- W08, E05: locked notices always go by e-mail, whatever path writes the preference.
create function app.notice_pref_locked() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not new.email and exists (
    select 1 from public.notice_type nt where nt.code = new.notice_code and nt.email_locked
  ) then
    raise exception 'notice % is always sent by e-mail', new.notice_code using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger email_locked before insert or update on public.notice_pref
  for each row execute function app.notice_pref_locked();
