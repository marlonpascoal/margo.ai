// The ten notice e-mails of 04 §9 (templates in apps/web/emails, E01 and E02 drawn) and their G-SYN
// examples, shown in the console preview ("Ver e-mail que o dono recebe", C21) and used by the tests.
import type { Recipient } from "@/lib/notify/plan";
import type { MessageSource, NoticeCode } from "@/lib/notify/templates";
import { closeReadyEmail } from "./E01-fechamento";
import { deadlineSoonEmail } from "./E02-prazo";
import { renderEmail, type EmailContent, type EmailOptions } from "./layout";
import {
  billingResultEmail,
  creditConfirmedEmail,
  dataStaleEmail,
  invoicesMissingEmail,
  newDifferenceEmail,
  securityEventEmail,
  trialEndingEmail,
  weeklySummaryEmail,
} from "./notices";

export { closeReadyEmail, deadlineSoonEmail };
export * from "./notices";
export { renderEmail, type EmailContent } from "./layout";

/** What notify() takes for a notice e-mail: rendered per person, so the footer names their role. */
export function emailSource(content: EmailContent, opts: EmailOptions): MessageSource {
  return (to: Recipient) => renderEmail(content, to, opts);
}

/** E01, E02 as drawn (Grupo Exemplo); the others with G-SYN numbers. All synthetic. */
export const EXAMPLES: Record<NoticeCode, EmailContent> = {
  close_ready: closeReadyEmail({
    accountName: "Grupo Exemplo",
    month: "2026-09-01",
    kitchens: 2,
    channels: ["iFood", "99Food"],
    grossCents: 24_800_000,
    payoutCents: 18_630_000,
    leftCents: 8_680_000,
    wrongCents: 241_000,
  }),
  deadline_soon: deadlineSoonEmail({
    daysLeft: 3,
    deadlineOn: "2026-11-15",
    amountCents: 64_000,
    channel: "iFood",
    what: "o cupom cofinanciado",
    explanation: "31 pedidos da Cozinha Centro tiveram o desconto do cupom debitado inteiro da loja. Pelo acordo da campanha, o iFood paga metade.",
  }),
  new_difference: newDifferenceEmail({
    channel: "iFood",
    store: "Cozinha Centro",
    description: "O desconto do cupom foi debitado inteiro da loja; pelo acordo, o iFood paga metade.",
    ordersCount: 31,
    amountCents: 64_000,
  }),
  credit_confirmed: creditConfirmedEmail({ channel: "iFood", amountCents: 23_800, creditedOn: "2026-10-22", what: "pedidos cancelados pelo cliente" }),
  data_stale: dataStaleEmail({ reason: "extension_silent", days: 3, store: "Pantanos Burguer" }),
  invoices_missing: invoicesMissingEmail({ ingredients: ["pão brioche", "bacon fatiado", "queijo prato"] }),
  weekly_summary: weeklySummaryEmail({
    from: "2026-10-19",
    to: "2026-10-25",
    grossCents: 2_590_000,
    payoutCents: 1_940_000,
    newDifferencesCents: 18_600,
    openContestations: 2,
  }),
  trial_ending: trialEndingEmail({ daysLeft: 3, endsOn: "2026-11-08" }),
  billing_result: billingResultEmail({ approved: false, amountCents: 180_000, planName: "Lucro" }),
  security_event: securityEventEmail({ kind: "new_device", personName: "Dono do grupo", userAgent: "Chrome no Mac" }),
};

/** The drawn code of a notice e-mail, where there is one. */
export const DRAWN: Partial<Record<NoticeCode, string>> = { close_ready: "E01", deadline_soon: "E02" };
