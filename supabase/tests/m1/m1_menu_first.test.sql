-- D76: a capture asked before the discovery wakes the collect job when it ends, done or failed. All SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

insert into public.job (id, type, payload, status, dedupe_key)
values ('00000000-0000-4000-8000-00000000d761', 'extract_capture',
        jsonb_build_object('menu_first_xray', '00000000-0000-4000-8000-00000000d762'), 'running', 'mf-test');
update public.job set status = 'done' where id = '00000000-0000-4000-8000-00000000d761';
select is((select count(*)::int from public.job where type = 'collect'
            and payload ->> 'xray_id' = '00000000-0000-4000-8000-00000000d762' and status = 'queued'), 1,
  'the collect job runs again');

insert into public.job (id, type, payload, status, dedupe_key)
values ('00000000-0000-4000-8000-00000000d763', 'extract_capture', '{"public_store_id": "00000000-0000-4000-8000-00000000d764"}', 'running', 'mf-test-2');
update public.job set status = 'done' where id = '00000000-0000-4000-8000-00000000d763';
select is((select count(*)::int from public.job where type = 'collect'
            and payload ->> 'xray_id' = '00000000-0000-4000-8000-00000000d764'), 0, 'an ordinary capture wakes nothing');

select * from finish();
rollback;
