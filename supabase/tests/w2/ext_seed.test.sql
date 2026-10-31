-- Wave 2 extension and messages: schema additions and the G-SYN rows behind P04, C18 and the C21 queue.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select has_column('public', 'extension_token', 'paired_at', 'P04: a pending pairing is an unpaired extension_token');
select has_column('public', 'notification', 'html', 'E01, E02: HTML version of the e-mail');
select has_column('public', 'notification', 'manual_sent_at', '06 §7: founder marks a manual WhatsApp as sent');
select results_eq($$
  select count(*)::int from public.extension_token
  where token_hash = encode(sha256('g-syn-extensao-pantanos'::bytea), 'hex') and paired_at is not null and revoked_at is null
$$, array[1], 'Pantanos owner has a paired extension token (stored hashed)');
select results_eq($$ select primary_color, show_powered_by from public.bpo_partner where name = 'BPO 01' $$,
  $$ values ('#1351B4'::text, false) $$, 'C18: BPO 01 brand as drawn');
select results_eq($$ select pipeline_note from public.bpo_partner where name = 'BPO 02' $$,
  array['conversa marcada'], 'C18: BPO 02 without clients');

select * from finish();
rollback;
