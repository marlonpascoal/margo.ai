-- Launch with the X-ray only (Marlon, 08/nov): every feature outside the Raio-X is a flag, off at launch.
-- New flags for the owner screens that had none: portal.inicio (W01/P08 Início, M2/M3 numbers), portal.lojas (W02/P13
-- Lojas) and conta.plano (W05/P09 Plano e cobrança). In sandbox they follow the plan (off on Raio-X grátis, on for Lucro
-- and Rede) so the seed and the tests keep their screens and an X-ray-only account shows the launch portal. In
-- production every flag outside m1.* is off for every plan; m1.* keep their values (m1.portal stays off in production
-- until a founder turns it on in C20). Notificações and Segurança stay without a flag: they serve the X-ray too.

insert into public.feature_flag (key, description, default_raio_x, default_lucro, default_rede, env)
select k, d, false, s = 'sandbox', s = 'sandbox', s::public.flag_env
  from (values ('portal.inicio', 'Início do portal com vendas, repasses e diferenças'),
               ('portal.lojas', 'Lojas e cozinhas no portal'),
               ('conta.plano', 'Plano e cobrança no portal')) f (k, d)
 cross join (values ('sandbox'), ('production')) e (s);

update public.feature_flag set default_raio_x = false, default_lucro = false, default_rede = false
 where env = 'production' and key not like 'm1.%';
