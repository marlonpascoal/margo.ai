-- Notifier outbox (04 §9, §10, D36, D40). Team alerts (C21) go through the same outbox as owner
-- notices, but they are not one of the 10 notices of W08: such a row names its alert instead of a
-- notice type, and carries its own destination (the team address or the founder on duty).

alter table public.notification
  add column alert_id uuid references public.alert (id) on delete cascade,
  add column recipient text;

alter table public.notification alter column notice_code drop not null;
alter table public.notification
  add constraint notification_notice_or_alert check ((notice_code is null) <> (alert_id is null));

comment on column public.notification.recipient is
  'E-mail address or WhatsApp number (E.164) fixed when the row is planned. Null: read from person at delivery.';
comment on column public.notification.provider_id is
  'Provider message id. For whatsapp_manual, the click-to-chat link a founder sends (D36).';

-- The outbox processor reads queued and held rows, oldest first.
create index notification_outbox on public.notification (created_at)
  where status in ('queued', 'held_quiet_hours');
create index notification_alert on public.notification (alert_id) where alert_id is not null;
