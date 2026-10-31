-- Wave 2, extension and messages: Chrome extension pairing (P04, 06 §9), e-mail bodies and the manual
-- WhatsApp queue (04 §9, 06 §7, E05), BPO brand (C18). Additive only.

-- P04 pairing (06 §9). A row starts as a pending pairing: token_hash holds the hash of the short code
-- shown in the portal or console, valid until pairing_expires_at. When the extension sends the code,
-- token_hash becomes the hash of the long token the extension keeps and paired_at is set. Only paired,
-- not revoked rows authenticate. Neither the code nor the token is stored in clear.
alter table public.extension_token
  add column pairing_expires_at timestamptz,
  add column paired_at timestamptz,
  add column created_by uuid references public.person (id) on delete set null;

comment on column public.extension_token.pairing_expires_at is
  'Pending pairing: the short code (hashed in token_hash) is valid until then. Null once paired.';
comment on column public.extension_token.paired_at is
  'When the extension exchanged the code for its token. Null: still a pending pairing, never authenticates.';
comment on column public.extension_token.created_by is
  'Who generated the code: the person in the portal, or a founder in the console (C07) for that person.';

create index extension_token_person on public.extension_token (person_id, account_id) where revoked_at is null;

-- E01, E02 and the other notices (04 §9): the HTML version of an e-mail next to its text body, and the
-- file attached (E01 attaches the P06 PDF, "<bucket>/<path>").
alter table public.notification
  add column html text,
  add column attachment_path text,
  -- 06 §7: a whatsapp_manual row is "sent" by the outbox when its click-to-chat link is ready; a founder
  -- sends it by hand from C21 and marks it here.
  add column manual_sent_at timestamptz,
  add column manual_sent_by uuid references public.person (id) on delete set null;

comment on column public.notification.manual_sent_at is
  'whatsapp_manual only: when a founder marked the message as sent from the console queue (C21).';

create index notification_manual_queue on public.notification (created_at)
  where channel = 'whatsapp_manual' and manual_sent_at is null;

-- C18: what the "Clientes no piloto" column says while a partner has no client yet ("conversa marcada").
alter table public.bpo_partner add column pipeline_note text;

-- C18 logos (PNG or SVG). Private, service role only, like the other buckets.
insert into storage.buckets (id, name, public) values ('bpo', 'bpo', false) on conflict (id) do nothing;
