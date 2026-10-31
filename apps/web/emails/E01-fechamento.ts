// E01 "fechamento do mês pronto" (design/E01-EmailFechamento.dc.html, notice close_ready, 05 §C).
// Numbers come from the close (C08 totals, REP-xx); "Sobrou depois dos insumos" needs module 3 (CST, CTB) and
// says "falta custo" until it exists, as P06 does. The PDF goes attached.
import { joinPt, plural } from "@/lib/format";
import { brl } from "@/lib/m2/format";
import type { EmailContent } from "./layout";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export interface CloseReadyData {
  accountName: string;
  /** First day of the month closed, yyyy-mm-dd. */
  month: string;
  kitchens: number;
  /** Channel labels in the close, e.g. ["iFood", "99Food"]. */
  channels: string[];
  /** REP: sold on delivery (C08 "Vendido"). */
  grossCents: number;
  /** REP: received from the apps (C08 "Recebido"). */
  payoutCents: number;
  /** CTB: left after ingredients; null until module 3 has the cost. */
  leftCents: number | null;
  /** DIF: charged wrong and still to contest. */
  wrongCents: number;
}

export const E01_COPY = {
  rows: ["Vendido no delivery", "Recebido dos apps", "Sobrou depois dos insumos", "Cobrado errado, para contestar"],
  button: "Abrir o fechamento",
  attached: "O PDF vai anexo. Os números ficam também no seu portal, por cozinha e por app.",
  // Not drawn: the close before module 3 has no cost (P06 says the same).
  noCost: "falta custo",
} as const;

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** E01, rules REP-01 to REP-04 (vendido, recebido), CTB (sobrou), DIF (cobrado errado). */
export function closeReadyEmail(d: CloseReadyData): EmailContent {
  const month = MONTHS[Number(d.month.slice(5, 7)) - 1];
  const subject =
    d.leftCents === null
      ? // Not drawn: without cost the subject says what was received.
        `${capital(month)} fechado: recebeu ${brl(d.payoutCents)} de ${brl(d.grossCents)}`
      : `${capital(month)} fechado: sobrou ${brl(d.leftCents)} de ${brl(d.grossCents)}`;
  return {
    subject,
    title: `Seu fechamento de ${month} está pronto`,
    blocks: [
      { kind: "p", text: [`${d.accountName}, ${plural(d.kitchens, "cozinha", "cozinhas")}, ${joinPt(d.channels)}.`] },
      {
        kind: "rows",
        rows: [
          { label: E01_COPY.rows[0], value: brl(d.grossCents) },
          { label: E01_COPY.rows[1], value: brl(d.payoutCents) },
          { label: E01_COPY.rows[2], value: d.leftCents === null ? E01_COPY.noCost : brl(d.leftCents), tone: d.leftCents === null ? undefined : "ok" },
          { label: E01_COPY.rows[3], value: brl(d.wrongCents), tone: "danger" },
        ],
      },
      { kind: "button", label: E01_COPY.button, path: "/app" },
      { kind: "p", text: [E01_COPY.attached], muted: true },
    ],
    // Not drawn: WhatsApp version, same numbers.
    whatsapp: `MargoAI: seu fechamento de ${month} está pronto. Vendido ${brl(d.grossCents)}, recebido ${brl(d.payoutCents)}, cobrado errado ${brl(d.wrongCents)}. O PDF está no seu portal.`,
  };
}
