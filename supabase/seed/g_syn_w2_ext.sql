-- G-SYN, wave 2 extension and messages: P04 popup, C18 brand, the manual WhatsApp queue (C21). SINTÉTICO.
-- Loaded after g_syn_m2.sql (./seed/*.sql). Values follow the drawings; "hoje" is 30/out/2026.
--
-- Filled in because no drawing shows them (synthetic, safe to change):
--   the extension token of the Pantanos owner for local tests: "g-syn-extensao-pantanos" (sha256 below);
--   a pending pairing code for the Grupo Exemplo owner: "GSYN-PAR1", valid until 2099.

create or replace function pg_temp.sid(tag text) returns uuid language sql immutable as $$ select md5('g-syn:' || tag)::uuid $$;

-- P04: "último envio: 28/out 21:14", the Pantanos extension source (C07 card for G-01).
insert into public.import_source (id, account_id, channel, kind, schedule_cron, last_ok_at, stale_after_hours) values
  (pg_temp.sid('G-01:src:ifood-ext'), pg_temp.sid('G-01'), 'ifood', 'extension', null, '2026-10-28 21:14-03', 72);

-- P04: the Pantanos owner's paired extension, and a pending code for the Grupo Exemplo owner.
insert into public.extension_token (id, person_id, account_id, token_hash, paired_at, created_by, created_at) values
  (pg_temp.sid('G-01:ext-token'), pg_temp.sid('p:g01-dono'), pg_temp.sid('G-01'),
   encode(sha256('g-syn-extensao-pantanos'::bytea), 'hex'), '2026-10-28 21:00-03', pg_temp.sid('p:g01-dono'), '2026-10-28 20:58-03');
insert into public.extension_token (id, person_id, account_id, token_hash, pairing_expires_at, created_by, created_at) values
  (pg_temp.sid('G-02:ext-pairing'), pg_temp.sid('p:g02-dono'), pg_temp.sid('G-02'),
   encode(sha256('GSYN-PAR1'::bytea), 'hex'), '2099-12-31 23:59-03', pg_temp.sid('p:marlon'), '2026-10-30 09:00-03');

-- C18 as drawn: BPO 01 in blue without "com tecnologia MargoAI"; BPO 02 has a call booked, no client yet.
update public.bpo_partner set primary_color = '#1351B4', show_powered_by = false where id = pg_temp.sid('bpo-01');
update public.bpo_partner set pipeline_note = 'conversa marcada' where id = pg_temp.sid('bpo-02');

-- C21 WhatsApp queue (06 §7): the Grupo Exemplo owner's deadline notice, ready for a founder to send.
insert into public.notification (id, account_id, person_id, notice_code, channel, subject, body, status, recipient, created_at) values
  (pg_temp.sid('G-02:wa:deadline'), pg_temp.sid('G-02'), pg_temp.sid('p:g02-dono'), 'deadline_soon', 'whatsapp_manual', null,
   'MargoAI: faltam 3 dias para contestar R$ 640,00 no iFood (cupom cofinanciado, Cozinha Centro). O texto pronto está no seu portal, em Contestações.',
   'queued', '+5543900001234', '2026-10-30 09:00-03');
