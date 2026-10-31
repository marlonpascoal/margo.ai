// Template slot for the 10 notices (04 §9). E01 (close_ready) and E02 (deadline_soon) are drawn; their
// full layouts come with the modules that compute their numbers. Every notice e-mail ends with the
// drawn footer saying why the person receives it.
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

/** The message for one person, with the footer added to the e-mail body. */
export function messageFor(source: MessageSource, to: Recipient): NoticeMessage {
  const m = typeof source === "function" ? source(to) : source;
  return { ...m, whatsapp: m.whatsapp ?? m.body, body: `${m.body}\n\n${emailFooter(to)}` };
}
