// E02 "prazo de contestação" (design/E02-EmailPrazo.dc.html, notice deadline_soon, 05 §C): sent 3 days before
// the deadline (04 §9), links to the claim text in W03. Amount from the difference (DIF-xx), deadline from
// the contestation (04 §3).
import { brl, brlCents, dayMon } from "@/lib/m2/format";
import type { EmailContent } from "./layout";

export interface DeadlineSoonData {
  /** Days left, 3 for the scheduled notice. */
  daysLeft: number;
  /** yyyy-mm-dd */
  deadlineOn: string;
  amountCents: number;
  /** "iFood", "99Food". */
  channel: string;
  /** What is being contested, with its article: "o cupom cofinanciado". */
  what: string;
  /** The difference said for the owner, ending with a period. */
  explanation: string;
}

/** Where the owner files the claim, per channel (E02 step 2). */
const PORTAL: Record<string, string> = { iFood: "Portal do Parceiro do iFood", "99Food": "portal da 99Food" };

export const E02_COPY = {
  step1: "Copie o texto pronto e baixe a planilha no seu portal.",
  step3: "Volte ao portal e toque em ",
  done: "Já contestei",
  button: "Ver o texto pronto",
  after: "Se o crédito aparecer no repasse, a gente marca como creditada sozinho e avisa você.",
} as const;

/** E02, rules DIF-xx (amount) and 04 §3 (deadline). */
export function deadlineSoonEmail(d: DeadlineSoonData): EmailContent {
  const days = d.daysLeft === 1 ? "Falta 1 dia" : `Faltam ${d.daysLeft} dias`;
  return {
    subject: `${days} para contestar ${brl(d.amountCents)} no ${d.channel}`,
    title: `O prazo para contestar ${d.what} acaba em ${dayMon(d.deadlineOn)}`,
    blocks: [
      { kind: "callout", text: [`${d.explanation} Diferença: `, { strong: brlCents(d.amountCents), mono: true }, "."] },
      {
        kind: "steps",
        items: [[E02_COPY.step1], [`Abra um chamado no ${PORTAL[d.channel] ?? `portal do ${d.channel}`} e cole o texto.`], [E02_COPY.step3, { strong: E02_COPY.done }, "."]],
      },
      { kind: "button", label: E02_COPY.button, path: "/app/contestacoes" },
      { kind: "p", text: [E02_COPY.after], muted: true },
    ],
    // Not drawn: WhatsApp version.
    whatsapp: `MargoAI: ${days.toLowerCase()} para contestar ${brlCents(d.amountCents)} no ${d.channel} (${d.what.replace(/^(o|a|os|as) /, "")}). O prazo acaba em ${dayMon(d.deadlineOn)}. O texto pronto está no seu portal, em Contestações.`,
  };
}
