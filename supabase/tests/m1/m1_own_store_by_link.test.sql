-- P20 "Uma loja minha" by the iFood link (20261231000004, Marlon 08/nov): an X-ray-only account has no channel_store,
-- yet its owner registers their own store by pasting its link and saying it is theirs. All data here is SINTÉTICO.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

create function pg_temp.id(tag text) returns uuid language sql immutable as $$ select md5('own-link:' || tag)::uuid $$;
create function pg_temp.ext(n int) returns text language sql immutable as $$ select 'abcdef02-0000-4000-8000-' || lpad(n::text, 12, '0') $$;
create function pg_temp.mk(acc text, n int, kind text) returns jsonb language sql as $$
  select public.monitor_create(pg_temp.id(acc), pg_temp.ext(n),
           'https://www.ifood.com.br/delivery/cidade-sintetica-pr/loja/' || pg_temp.ext(n), null, case when acc = 'R' then 90 else 7 end,
           3, '{}', '{}', pg_temp.id(acc || ':dono'), 'sandbox', null, null, kind)
$$;

-- Two accounts with no kitchen store at all: one on Raio-X grátis, one on Lucro.
insert into auth.users (id, email) select pg_temp.id(a || ':auth'), a || '@own-link.local' from unnest(array['R', 'L']) a;
insert into public.person (id, auth_user_id, name) select pg_temp.id(a || ':dono'), pg_temp.id(a || ':auth'), 'Dono ' || a from unnest(array['R', 'L']) a;
insert into public.account (id, name, code, plan_id, is_synthetic)
select pg_temp.id(a), 'Conta ' || a, 'OL-' || a, (select id from public.plan where code = p), true
  from (values ('R', 'raio_x'), ('L', 'lucro')) v (a, p);
insert into public.membership (account_id, person_id, role, all_kitchens)
select pg_temp.id(a), pg_temp.id(a || ':dono'), 'dono', true from unnest(array['R', 'L']) a;

select is(pg_temp.mk('R', 1, 'own') ->> 'target_kind', 'own', 'P20: "Uma loja minha" by link is own with no channel_store');
select results_eq($$ select target_kind, kitchen_id from public.xray_monitor where account_id = pg_temp.id('R') $$,
  $$ values ('own', null::uuid) $$, 'P20: an own store by link has no kitchen');
select is((select count(*)::int from public.xray x join public.xray_monitor m on m.id = x.monitor_id
            where m.account_id = pg_temp.id('R') and x.target_kind = 'own'), 1, 'the first run is an own X-ray');
select throws_ok($$ select pg_temp.mk('R', 2, 'own') $$, 'P0001', 'monitor_own_limit:1',
  'the plan own-store limit still holds');
select is(pg_temp.mk('L', 3, 'competitor') ->> 'target_kind', 'competitor', 'a pasted link marked competitor stays competitor');
select is(pg_temp.mk('L', 4, null) ->> 'target_kind', 'competitor', 'no kind keeps the old rule');
select throws_ok($$ select pg_temp.mk('L', 5, 'sua') $$, 'P0001', 'monitor_bad_kind', 'an unknown kind is refused');

select * from finish();
rollback;
