// The console's e-mail preview (C21 "Ver e-mail que o dono recebe"): who the example is addressed to.
import type { Recipient } from "./plan";
import type { NoticeCode } from "./templates";

/** The Grupo Exemplo owner, as in the E01 and E02 footers. */
export const previewRecipient: Recipient = {
  personId: "preview",
  accountId: "preview",
  accountName: "Grupo Exemplo",
  role: "dono",
  email: "dono@exemplo.com.br",
  whatsappE164: null,
};

/** notice_type.name (04 §9, W08). */
export const NOTICE_NAMES: Record<NoticeCode, string> = {
  close_ready: "Fechamento do mês pronto",
  new_difference: "Diferença nova no repasse",
  deadline_soon: "Prazo de contestação chegando",
  credit_confirmed: "Crédito confirmado no repasse",
  data_stale: "Dados parados",
  invoices_missing: "Notas faltando",
  weekly_summary: "Resumo da semana",
  trial_ending: "Teste grátis acabando",
  billing_result: "Cobrança aprovada ou recusada",
  security_event: "Pessoa nova ou login em aparelho novo",
};
