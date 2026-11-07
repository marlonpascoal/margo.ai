// Notice codes and the plain-text footer (04 §9). The e-mails themselves (E01, E02 drawn, the other eight in
// the same layout) live in apps/web/emails; every notice e-mail ends with the drawn footer saying why the
// person receives it.
import type { NoticeMessage, Recipient, Role } from "./plan";

export type NoticeCode =
  | "close_ready"
  | "new_difference"
  | "deadline_soon"
  | "credit_confirmed"
  | "data_stale"
  | "invoices_missing"
  | "weekly_summary"
  | "trial_ending"
  | "billing_result"
  | "security_event";

/** M1 owner journey notices (PROVISIONAL, 20261230000001_m1_monitor.sql): notice_type rows and preferences exist; the
 * e-mails, the W08 rows and the sending come with P19 to P24. Audience Dono and Gerente (their kitchens only, filtered by
 * the sender on xray_monitor.kitchen_id). */
export type M1NoticeCode = "xray_ready" | "xray_needs_answer";
export const M1_NOTICE_NAMES: Record<M1NoticeCode, string> = {
  xray_ready: "Seu raio-X está pronto",
  xray_needs_answer: "Itens esperando sua resposta",
};

/** Builds one person's message from the notice data. */
export type NoticeTemplate<D> = (data: D, to: Recipient) => NoticeMessage;

/** What notify() takes: a fixed message or one built per person. */
export type MessageSource = NoticeMessage | ((to: Recipient) => NoticeMessage);

export const ROLE_LABEL: Record<Role, string> = { dono: "Dono", financeiro: "Financeiro", gerente: "Gerente" };

export const NOTIFICATIONS_PATH = "/app/notificacoes";

/** E01, E02 footer. */
export function emailFooter(to: Recipient): string {
  return `Você recebe este e-mail porque é ${ROLE_LABEL[to.role]} no ${to.accountName}.\nMudar notificações: ${NOTIFICATIONS_PATH}`;
}

/** The message for one person, with the footer added to the e-mail body (templates of apps/web/emails have it). */
export function messageFor(source: MessageSource, to: Recipient): NoticeMessage {
  const m = typeof source === "function" ? source(to) : source;
  if (m.html) return { ...m, whatsapp: m.whatsapp ?? m.body };
  return { ...m, whatsapp: m.whatsapp ?? m.body, body: `${m.body}\n\n${emailFooter(to)}` };
}
