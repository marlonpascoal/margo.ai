-- Launch with the X-ray only (20261231000005, Marlon 08/nov): every feature outside the Raio-X is a flag, off at launch.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

select results_eq($$ select key from public.feature_flag where key in ('portal.inicio', 'portal.lojas', 'conta.plano') and env = 'sandbox' order by key $$,
  $$ values ('conta.plano'), ('portal.inicio'), ('portal.lojas') $$, 'the owner screens without a flag get one');
select is((select count(*)::int from public.feature_flag
            where env = 'production' and key not like 'm1.%' and (default_raio_x or default_lucro or default_rede)), 0,
  'production: every flag outside the Raio-X is off for every plan');
select results_eq($$ select key, default_raio_x from public.feature_flag where env = 'production' and key in ('m1.raio_x', 'm1.portal') order by key $$,
  $$ values ('m1.portal', false), ('m1.raio_x', true) $$, 'production: the Raio-X flags keep their values');
select is((select count(*)::int from public.feature_flag
            where env = 'sandbox' and key in ('portal.inicio', 'portal.lojas', 'conta.plano') and not default_raio_x and default_lucro and default_rede), 3,
  'sandbox: the new screen flags are off on Raio-X grátis, on for Lucro and Rede');
select is((select count(*)::int from public.feature_flag where env = 'sandbox' and key not like 'm1.%' and default_raio_x), 0,
  'sandbox: an X-ray-only account has every other feature off');

select * from finish();
rollback;
