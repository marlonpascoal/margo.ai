-- Reference data every environment needs: plans (D28, D40 placeholders), feature flags (04 §6)
-- and notice types (04 §9). Names and descriptions as drawn in W05, C20 and W08.

insert into public.plan (code, name, price_cents, billing_unit, trial_days) values
  ('raio_x', 'Raio-X', 0, 'kitchen', 14),
  ('lucro', 'Lucro', 30000, 'kitchen', 14),   -- placeholder from the ad-test page, set in C15 before go-live
  ('rede', 'Rede', null, 'kitchen', 14);      -- price by conversation

-- 04 §6. m2.arquivo_ifood and auth.whatsapp_code are not in the C20 drawing; their descriptions follow its style.
insert into public.feature_flag (key, description, default_raio_x, default_lucro, default_rede, env)
select f.key, f.description, f.raio_x, f.lucro, f.rede, e.env
from (values
  ('m1.raio_x', 'Raio-X de preço por dado público', true, true, true),
  ('m2.ifood_api', 'Leitura do iFood pela API oficial', false, true, true),
  ('m2.extensao_chrome', 'Extensão do Chrome', false, true, true),
  ('m2.arquivo_99food', 'Importar extrato da 99Food', false, true, true),
  ('m2.arquivo_ifood', 'Importar arquivo exportado do Portal do Parceiro iFood', false, true, true),
  ('m2.contestacao', 'Diferenças e contestação', false, true, true),
  ('m3.notas_xml', 'Notas da pasta do contador', false, true, true),
  ('m3.nfce_qr_auto', 'Leitura automática do QR (SP e PR)', false, false, false),
  ('m3.depara_ia', 'Sugestão de insumo pela IA', false, true, true),
  ('conta.multi_cozinha', 'Mais de uma cozinha por conta', false, true, true),
  ('conta.pessoas', 'Convidar pessoas e perfis', false, true, true),
  ('bpo.marca_propria', 'Fechamento com a marca do BPO', false, false, false),
  ('l.painel_dono', 'Painel do dono (L01)', false, false, false),
  ('l.aprovacao_cupom', 'Aprovação de cupom no WhatsApp (L02)', false, false, false),
  ('auth.whatsapp_code', 'Código de login pelo WhatsApp', false, false, false)
) as f (key, description, raio_x, lucro, rede)
cross join (values ('sandbox'::public.flag_env), ('production'::public.flag_env)) as e (env);

-- 04 §9.
insert into public.notice_type (code, name, audience_roles, email_locked, default_email, default_whatsapp) values
  ('close_ready', 'Fechamento do mês pronto', array['dono', 'financeiro'], false, true, true),
  ('new_difference', 'Diferença nova no repasse', array['dono', 'financeiro'], false, true, false),
  ('deadline_soon', 'Prazo de contestação chegando', array['dono', 'financeiro'], false, true, true),
  ('credit_confirmed', 'Crédito confirmado no repasse', array['dono', 'financeiro'], false, true, false),
  ('data_stale', 'Dados parados', array['dono'], false, true, true),
  ('invoices_missing', 'Notas faltando', array['dono', 'financeiro'], false, false, true),
  ('weekly_summary', 'Resumo da semana', array['dono', 'financeiro', 'gerente'], false, true, false),
  ('trial_ending', 'Teste grátis acabando', array['dono'], true, true, true),
  ('billing_result', 'Cobrança aprovada ou recusada', array['dono'], true, true, false),
  ('security_event', 'Pessoa nova ou login em aparelho novo', array['dono'], true, true, false);
