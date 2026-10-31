// The other eight notices of 04 §9, in the E01 and E02 layout. None is drawn: subjects and texts are short,
// in the drawings' voice, and listed for Marlon. No em dashes.
import { joinPt, plural } from "@/lib/format";
import { brl, brlCents, dayMon } from "@/lib/m2/format";
import type { EmailContent } from "./layout";

/** new_difference, rule DIF-xx: a difference found by an import. */
export interface NewDifferenceData {
  channel: string;
  store: string;
  /** What happened, ending with a period. */
  description: string;
  ordersCount: number;
  amountCents: number;
}

export function newDifferenceEmail(d: NewDifferenceData): EmailContent {
  return {
    subject: `Diferença nova no repasse: ${brl(d.amountCents)} no ${d.channel}`,
    title: `Achamos ${brlCents(d.amountCents)} cobrados errado no ${d.channel}`,
    blocks: [
      { kind: "callout", text: [`${plural(d.ordersCount, "pedido", "pedidos")} da ${d.store}. ${d.description} Diferença: `, { strong: brlCents(d.amountCents), mono: true }, "."] },
      { kind: "button", label: "Ver a diferença", path: "/app/contestacoes" },
      { kind: "p", text: ["O texto para contestar já está pronto no seu portal."], muted: true },
    ],
    whatsapp: `MargoAI: achamos ${brlCents(d.amountCents)} cobrados errado no ${d.channel} (${d.store}). O texto para contestar está no seu portal.`,
  };
}

/** credit_confirmed, 04 §3 "creditada": the credit showed up in a payout. */
export interface CreditConfirmedData {
  channel: string;
  amountCents: number;
  /** yyyy-mm-dd of the payout that carried it. */
  creditedOn: string;
  what: string;
}

export function creditConfirmedEmail(d: CreditConfirmedData): EmailContent {
  return {
    subject: `Crédito confirmado: ${brl(d.amountCents)} voltaram do ${d.channel}`,
    title: `O ${d.channel} devolveu ${brlCents(d.amountCents)}`,
    blocks: [
      { kind: "callout", tone: "ok", text: [`O crédito de ${d.what} apareceu no repasse de ${dayMon(d.creditedOn)}. A gente marcou a contestação como creditada.`] },
      { kind: "button", label: "Ver contestações", path: "/app/contestacoes" },
    ],
    whatsapp: `MargoAI: o ${d.channel} devolveu ${brlCents(d.amountCents)} (${d.what}), no repasse de ${dayMon(d.creditedOn)}.`,
  };
}

/** data_stale (04 §9, §11): extension silent 3 days, or the iFood authorization revoked (06 §1). */
export interface DataStaleData {
  reason: "extension_silent" | "authorization_revoked";
  /** Days without data, for extension_silent. */
  days: number;
  store: string;
}

export function dataStaleEmail(d: DataStaleData): EmailContent {
  if (d.reason === "authorization_revoked") {
    return {
      subject: "A autorização do iFood foi retirada",
      title: `Paramos de receber os dados da ${d.store}`,
      blocks: [
        { kind: "p", text: ["A permissão da MargoAI no Portal do Parceiro foi retirada. Sem ela, o fechamento e as diferenças param."] },
        { kind: "steps", items: [["Abra o Portal do Parceiro, em Aplicativos."], ["Toque em Permitir na MargoAI."]] },
        { kind: "button", label: "Conectar os apps", path: "/app/conectar" },
      ],
      whatsapp: `MargoAI: a autorização do iFood da ${d.store} foi retirada. Para voltar, permita a MargoAI no Portal do Parceiro, em Aplicativos.`,
    };
  }
  const days = plural(d.days, "dia", "dias");
  return {
    subject: `Seus dados do iFood estão parados há ${days}`,
    title: `A extensão não manda dados da ${d.store} há ${days}`,
    blocks: [
      { kind: "p", text: ["A extensão só envia quando você abre o Portal do Parceiro no computador. Abra o portal e toque em Exportar e enviar."] },
      { kind: "button", label: "Conectar os apps", path: "/app/conectar" },
    ],
    whatsapp: `MargoAI: a extensão não manda dados da ${d.store} há ${days}. Abra o Portal do Parceiro no computador e toque em Exportar e enviar.`,
  };
}

/** invoices_missing (04 §9, CST-01): top-20 ingredients without a price from an invoice. */
export interface InvoicesMissingData {
  ingredients: string[];
}

export function invoicesMissingEmail(d: InvoicesMissingData): EmailContent {
  const n = plural(d.ingredients.length, "insumo", "insumos");
  return {
    subject: `Faltam notas de ${n}`,
    title: `Faltam notas de compra de ${n}`,
    blocks: [
      { kind: "p", text: [`Sem a nota, o custo usa a estimativa da região: ${joinPt(d.ingredients)}.`] },
      { kind: "p", text: ["Mande a chave ou a foto do QR da nota pelo WhatsApp, ou peça o arquivo XML ao seu contador."], muted: true },
    ],
    whatsapp: `MargoAI: faltam notas de compra de ${joinPt(d.ingredients)}. Pode mandar a foto do QR da nota aqui.`,
  };
}

/** weekly_summary (04 §9): Monday 8h, the week before. */
export interface WeeklySummaryData {
  /** yyyy-mm-dd of the Monday and Sunday. */
  from: string;
  to: string;
  grossCents: number;
  payoutCents: number;
  newDifferencesCents: number;
  openContestations: number;
}

export function weeklySummaryEmail(d: WeeklySummaryData): EmailContent {
  const week = `${dayMon(d.from)} a ${dayMon(d.to)}`;
  return {
    subject: `Resumo da semana: vendeu ${brl(d.grossCents)}`,
    title: `Sua semana de ${week}`,
    blocks: [
      {
        kind: "rows",
        rows: [
          { label: "Vendido no delivery", value: brl(d.grossCents) },
          { label: "Recebido dos apps", value: brl(d.payoutCents) },
          { label: "Diferenças novas", value: brl(d.newDifferencesCents), tone: d.newDifferencesCents ? "danger" : undefined },
          { label: "Contestações abertas", value: String(d.openContestations) },
        ],
      },
      { kind: "button", label: "Abrir o portal", path: "/app" },
    ],
    whatsapp: `MargoAI: na semana de ${week} você vendeu ${brl(d.grossCents)} e recebeu ${brl(d.payoutCents)}.`,
  };
}

/** trial_ending (04 §7): 3 days before and on the day. E-mail locked on. */
export interface TrialEndingData {
  daysLeft: number;
  /** yyyy-mm-dd */
  endsOn: string;
}

export function trialEndingEmail(d: TrialEndingData): EmailContent {
  const when = d.daysLeft <= 0 ? "hoje" : `em ${plural(d.daysLeft, "dia", "dias")}`;
  return {
    subject: `Seu teste grátis acaba ${when}`,
    title: `Seu teste grátis acaba ${when}, em ${dayMon(d.endsOn)}`,
    blocks: [
      { kind: "p", text: ["Sem um plano, a conta volta para o Raio-X grátis: as importações dos apps param e seus dados ficam guardados."] },
      { kind: "button", label: "Escolher um plano", path: "/app/plano" },
    ],
    whatsapp: `MargoAI: seu teste grátis acaba ${when} (${dayMon(d.endsOn)}). Para continuar com o fechamento, escolha um plano no portal.`,
  };
}

/** billing_result (04 §7, Asaas webhook): a charge approved or refused. E-mail locked on. */
export interface BillingResultData {
  approved: boolean;
  amountCents: number;
  planName: string;
}

export function billingResultEmail(d: BillingResultData): EmailContent {
  if (d.approved) {
    return {
      subject: `Cobrança aprovada: ${brlCents(d.amountCents)}`,
      title: `Recebemos ${brlCents(d.amountCents)} do plano ${d.planName}`,
      blocks: [
        { kind: "p", text: ["Obrigado. A nota e o recibo ficam em Plano e cobrança."] },
        { kind: "button", label: "Ver plano e cobrança", path: "/app/plano" },
      ],
      whatsapp: `MargoAI: cobrança de ${brlCents(d.amountCents)} aprovada.`,
    };
  }
  return {
    subject: "Cobrança recusada no cartão",
    title: `O cartão recusou a cobrança de ${brlCents(d.amountCents)}`,
    blocks: [
      { kind: "callout", text: [`O plano ${d.planName} segue ativo por enquanto. Troque o cartão para a próxima tentativa.`] },
      { kind: "button", label: "Trocar o cartão", path: "/app/plano" },
    ],
    whatsapp: `MargoAI: o cartão recusou a cobrança de ${brlCents(d.amountCents)}. Troque o cartão em Plano e cobrança.`,
  };
}

/** security_event (04 §8): a login on a new device, or a new person in the account. E-mail locked on. */
export interface SecurityEventData {
  kind: "new_device" | "new_person";
  personName: string;
  /** new_device: the browser, as the device list shows it. */
  userAgent?: string | null;
}

export function securityEventEmail(d: SecurityEventData): EmailContent {
  if (d.kind === "new_person") {
    return {
      subject: "Pessoa nova na conta",
      title: `${d.personName} entrou na sua conta`,
      blocks: [
        { kind: "p", text: ["Se você não convidou essa pessoa, tire o acesso dela em Pessoas."] },
        { kind: "button", label: "Ver pessoas", path: "/app/pessoas" },
      ],
      whatsapp: `MargoAI: ${d.personName} entrou na sua conta.`,
    };
  }
  return {
    // Subject as already sent by login (lib/notify/security.ts).
    subject: "Login em aparelho novo",
    title: "Login em aparelho novo",
    blocks: [
      { kind: "p", text: [`${d.personName} entrou na MargoAI por um aparelho novo${d.userAgent ? ` (${d.userAgent})` : ""}.`] },
      { kind: "p", text: ["Se não foi você, saia de todos os aparelhos em Segurança."], muted: true },
      { kind: "button", label: "Ver aparelhos", path: "/app/seguranca" },
    ],
    whatsapp: `MargoAI: ${d.personName} entrou por um aparelho novo.`,
  };
}
