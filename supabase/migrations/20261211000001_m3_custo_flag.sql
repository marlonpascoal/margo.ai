-- Feature flag m3.custo (04 §6, Marlon 31/out): gates C12 fichas, C13 contribution, the compute_contribution
-- job (JOB_FLAGS) and W01 "sobrou depois dos insumos". Defaults follow the other M3 flags: off on Raio-X,
-- on on Lucro and Rede, so the G-SYN accounts that show M3 today (Lucro) keep it on.
-- The description is copy without a drawing (C20 style), listed for Marlon.
insert into public.feature_flag (key, description, default_raio_x, default_lucro, default_rede, env)
select 'm3.custo', 'Ficha técnica, custo e sobra por item', false, true, true, e.env
from (values ('sandbox'::public.flag_env), ('production'::public.flag_env)) as e (env);
