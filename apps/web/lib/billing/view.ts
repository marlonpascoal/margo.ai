// What P09/W05 (/app/plano) and C15 (/console/assinaturas) show, built from rows by pure functions
// (tested in view.test.ts) and loaded with the service role after the page's permission check.
// Copy is verbatim from design/P09-Plano, W05-Plano and C15-Assinaturas; lines not drawn are marked.
import { brl, brlCents, monthShort } from "@/lib/m2/format";
import type { Db } from "@/lib/supabase/admin";
import { isSandbox, type AsaasConfig } from "./asaas";
import {
  monthlyTotalCents,
  pilotChargeCents,
  pilotWindowInMonth,
  spDate,
  trialDaysLeft,
  unitWord,
  addMonth,
  ddMon,
  monthOf,
  type PlanRow,
  type SubscriptionStatus,
} from "./rules";
import { SupabaseBillingStore } from "./supabase-store";
import type { InvoiceStatus, PilotRow, SubscriptionRow } from "./store";

/** Whole reais when round ("R$ 300"), else with centavos ("R$ 47,60"). */
export const money = (cents: number) => (cents % 100 === 0 ? brl(cents) : brlCents(cents));

/** Drawn plan descriptions (P09, W05); the plan table has no text column. */
const DESCRIPTION: Record<string, string> = {
  raio_x: "Raio-X de preço contra a vizinhança, uma vez por trimestre. Sem conectar nada.",
  lucro: "Fechamento mensal por canal, diferenças no repasse com contestação, e quanto sobra por item com o custo das notas.",
  rede: "Tudo do Lucro, com preço por conversa e atendimento direto dos fundadores.",
};

// P09 / W05 ----------------------------------------------------------------------------------------

export type PlanAction = "stay_free" | "checkout" | "rede" | "current" | "none";

export interface PlanCard {
  code: string;
  name: string;
  /** P09: "R$ 300/loja/mês", "grátis", "5 lojas ou mais". */
  pricePhone: string;
  /** W05: "R$ 300 por cozinha/mês". */
  priceWide: string;
  description: string;
  /** W05: "2 cozinhas na análise = R$ 600/mês"; empty for the others. */
  calc: string;
  /** P09 "Escolhido:" total: "R$ 0", "R$ 300/mês", "a combinar". */
  total: string;
  action: PlanAction;
  /** W05 button and P09 bottom button. */
  ctaWide: string;
  ctaPhone: string;
}

export interface PlanInvoice {
  id: string;
  month: string;
  units: string;
  value: string;
  status: string;
}

export interface PlanView {
  /** P09 heading and lead. */
  phoneTitle: string;
  phoneLead: string;
  /** W05 line under "Plano e cobrança". */
  wideLead: string;
  example: boolean;
  synthetic: boolean;
  /** Return from the Asaas page (05 P10): "processando" until the webhook. */
  banner: string | null;
  cards: PlanCard[];
  /** The card selected first on the phone (P09 starts on Lucro, as drawn). */
  selected: string;
  invoices: PlanInvoice[];
}

export interface PlanInput {
  plans: PlanRow[];
  sub: SubscriptionRow;
  trialEndsAt: Date | null;
  /** Kitchens (or channel stores) in analysis now. */
  units: number;
  isSynthetic: boolean;
  invoices: { asaasPaymentId: string; dueOn: string | null; units: number | null; amountCents: number; status: InvoiceStatus }[];
  /** ?status= from the Asaas return URL. */
  returnStatus: string | null;
  now: Date;
}

const INVOICE_STATUS: Record<InvoiceStatus, string> = {
  // Not drawn (W05 has no invoice yet).
  pending: "a pagar",
  confirmed: "paga",
  overdue: "atrasada",
  refused: "recusada",
  canceled: "cancelada",
};

function priceLabels(plan: PlanRow): { phone: string; wide: string } {
  const one = unitWord(plan.billingUnit, 1);
  if (plan.priceCents === 0) return { phone: "grátis", wide: "grátis" };
  if (plan.priceCents === null) {
    const many = `5 ${unitWord(plan.billingUnit, 5)} ou mais`;
    return { phone: many, wide: many };
  }
  return { phone: `${money(plan.priceCents)}/${one}/mês`, wide: `${money(plan.priceCents)} por ${one}/mês` };
}

/** P09/W05 "Done when": the Lucro total equals price times kitchens (or stores) in analysis (04 §7). */
export function lucroCalc(plan: PlanRow, units: number): string {
  const total = monthlyTotalCents(plan, units);
  return total === null ? "" : `${units} ${unitWord(plan.billingUnit, units)} na análise = ${money(total)}/mês`;
}

/** "acaba em 9 dias", "acaba em 1 dia", "acaba hoje". */
function endsIn(days: number): string {
  return days <= 0 ? "acaba hoje" : `acaba em ${days} ${days === 1 ? "dia" : "dias"}`;
}

export function buildPlanView(input: PlanInput): PlanView {
  const { sub, plans, now } = input;
  const current = plans.find((p) => p.id === sub.planId);
  const chosenLucro = sub.status === "trial" && !!sub.asaasSubscriptionId;
  const paying = sub.status === "active" || sub.status === "past_due";
  const isFree = sub.status === "free" || sub.status === "canceled";
  const inTrial = sub.status === "trial" && !chosenLucro;
  const trialEnd = input.trialEndsAt;
  const days = trialEnd ? trialDaysLeft(trialEnd, now) : 0;

  const cards: PlanCard[] = plans.map((plan) => {
    const price = priceLabels(plan);
    const total = monthlyTotalCents(plan, input.units);
    let action: PlanAction;
    if (plan.code === "raio_x") action = inTrial ? "stay_free" : isFree ? "current" : "none";
    else if (plan.code === "lucro") action = paying || chosenLucro ? "current" : "checkout";
    else action = "rede";
    const ctaWide = { stay_free: "Ficar no grátis", checkout: "Assinar pelo Asaas", rede: "Falar com a gente", current: "Seu plano", none: "" }[action];
    const ctaPhone = action === "checkout" ? "Continuar para o pagamento" : ctaWide;
    return {
      code: plan.code,
      name: plan.name,
      pricePhone: price.phone,
      priceWide: price.wide,
      description: DESCRIPTION[plan.code] ?? "",
      calc: plan.code === "lucro" ? lucroCalc(plan, input.units) : "",
      total: plan.priceCents === null ? "a combinar" : plan.priceCents === 0 ? "R$ 0" : `${money(total ?? 0)}/mês`,
      action,
      ctaWide,
      ctaPhone,
    };
  });

  const endDay = trialEnd ? ddMon(trialEnd) : "";
  const nextDue = sub.nextDueOn ? ddMon(sub.nextDueOn) : "";
  const card = " Só cartão de crédito, pelo Asaas.";
  let phoneTitle: string;
  let phoneLead: string;
  let wideLead: string;
  if (inTrial) {
    phoneTitle = `Seu teste grátis ${endsIn(days)}`;
    phoneLead = "Escolha como continuar. Se não escolher, a conta volta para o plano grátis e nada é cobrado.";
    wideLead = `Teste grátis até ${endDay}.${card}`;
  } else if (chosenLucro) {
    // Not drawn.
    phoneTitle = "Plano Lucro escolhido";
    phoneLead = `A primeira cobrança sai em ${nextDue || endDay}, quando o teste acabar.`;
    wideLead = `Plano Lucro escolhido. A primeira cobrança sai em ${nextDue || endDay}, quando o teste acabar.${card}`;
  } else if (paying) {
    // Not drawn.
    phoneTitle = sub.status === "past_due" ? "Pagamento atrasado" : `Seu plano: ${current?.name ?? "Lucro"}`;
    phoneLead = sub.status === "past_due" ? "O Asaas não conseguiu cobrar o cartão. Confira o cartão pela fatura." : nextDue ? `Próxima cobrança em ${nextDue}.` : "";
    wideLead = `${phoneTitle}.${nextDue ? ` Próxima cobrança em ${nextDue}.` : ""}${card}`;
  } else {
    // Not drawn: free after the trial, or canceled.
    phoneTitle = "Seu plano: Raio-X grátis";
    phoneLead = "O fechamento por canal parou de atualizar. Escolha o Lucro para voltar.";
    wideLead = `Plano Raio-X grátis.${card}`;
  }

  let banner: string | null = null;
  if (input.returnStatus === "sucesso" && !paying && !chosenLucro) banner = "Pagamento processando. Assim que o Asaas confirmar, o plano aparece aqui.";
  if (input.returnStatus === "cancelado" || input.returnStatus === "expirado") banner = "Pagamento não concluído. Nada foi cobrado.";

  return {
    phoneTitle,
    phoneLead,
    wideLead,
    example: plans.some((p) => p.priceIsExample && p.priceCents !== null && p.priceCents > 0),
    synthetic: input.isSynthetic,
    banner,
    cards,
    selected: "lucro",
    invoices: input.invoices.map((i) => ({
      id: i.asaasPaymentId,
      month: i.dueOn ? monthShort(i.dueOn) : "",
      units: i.units === null ? "" : String(i.units),
      value: brlCents(i.amountCents),
      status: INVOICE_STATUS[i.status],
    })),
  };
}

/** Service-role read for /app/plano, after requirePlanOwner(). */
export async function loadPlanView(db: Db, accountId: string, returnStatus: string | null, now: Date): Promise<PlanView> {
  const store = new SupabaseBillingStore(db);
  const [plans, sub, account] = await Promise.all([store.plans(), store.subscription(accountId), store.account(accountId)]);
  if (!sub || !account) throw new Error(`account ${accountId} has no subscription`);
  const lucro = plans.find((p) => p.code === "lucro");
  const units = await store.countUnits(accountId, lucro?.billingUnit ?? "kitchen");
  const { data, error } = await db
    .from("billing_invoice")
    .select("asaas_payment_id, due_on, units, amount_cents, status")
    .eq("account_id", accountId)
    .order("due_on", { ascending: false });
  if (error) throw new Error(error.message);
  return buildPlanView({
    plans,
    sub,
    trialEndsAt: account.trialEndsAt,
    units,
    isSynthetic: account.isSynthetic,
    invoices: (data ?? []).map((r) => ({ asaasPaymentId: r.asaas_payment_id, dueOn: r.due_on, units: r.units, amountCents: r.amount_cents, status: r.status })),
    returnStatus,
    now,
  });
}

// C15 ----------------------------------------------------------------------------------------------

export type Tone = "ok" | "warn" | "muted" | "danger";

export interface SubscriptionLine {
  accountId: string;
  account: string;
  plan: string;
  units: string;
  status: string;
  tone: Tone;
  next: string;
  asaas: string;
  lastEvent: string;
}

export interface PilotLine {
  id: string;
  accountId: string;
  account: string;
  pct: string;
  cap: string;
  fixed: string;
  startedOn: string;
  next: string;
}

export interface C15View {
  kpis: { trial: number; trialDays: number; paying: number; revenue: string; pastDue: number };
  /** "loja" or "cozinha", from the Lucro plan (D40). */
  unit: "loja" | "cozinha";
  rows: SubscriptionLine[];
  pilots: PilotLine[];
  /** "R$ 300 por cozinha": the C15 "A partir do mês 3" hint (D37 per unit). */
  fixedHint: string;
  plans: PlanRow[];
  accounts: { id: string; label: string; hasPilot: boolean }[];
  labels: string[];
}

export interface C15Input {
  plans: PlanRow[];
  accounts: { id: string; code: string; name: string; trialEndsAt: Date | null; isSynthetic: boolean; createdAt: string }[];
  subs: SubscriptionRow[];
  pilots: PilotRow[];
  /** Credited items per account (C16), for the pilot preview. */
  credited: Map<string, { amountCents: number; creditedOn: string }[]>;
  asaas: AsaasConfig;
  now: Date;
}

const STATUS_ORDER: Record<SubscriptionStatus, number> = { active: 0, past_due: 1, trial: 2, free: 3, canceled: 4 };

/** "sub_00000000a91f" -> "sub_…a91f", as drawn. */
export function shortAsaasId(id: string | null): string {
  if (!id) return "";
  const i = id.indexOf("_");
  return i < 0 || id.length - i - 1 <= 4 ? id : `${id.slice(0, i + 1)}…${id.slice(-4)}`;
}

/** Fraction to "20%", "12,5%". */
export const pctLabel = (pct: number) => `${String(Math.round(pct * 10000) / 100).replace(".", ",")}%`;

export function buildC15View(input: C15Input): C15View {
  const { plans, now } = input;
  const plan = new Map(plans.map((p) => [p.id, p]));
  const lucro = plans.find((p) => p.code === "lucro");
  const unit = lucro?.billingUnit === "channel_store" ? "loja" : "cozinha";
  const accounts = new Map(input.accounts.map((a) => [a.id, a]));
  const label = (id: string) => {
    const a = accounts.get(id);
    return a ? `${a.name} (${a.code})` : id;
  };
  const value = (s: SubscriptionRow) => monthlyTotalCents(plan.get(s.planId) ?? { priceCents: null }, s.unitsBilled);

  const rows = [...input.subs]
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (accounts.get(b.accountId)?.createdAt ?? "").localeCompare(accounts.get(a.accountId)?.createdAt ?? ""))
    .map((s): SubscriptionLine => {
      const p = plan.get(s.planId);
      const ends = accounts.get(s.accountId)?.trialEndsAt ?? null;
      const days = ends ? trialDaysLeft(ends, now) : null;
      const v = value(s);
      const due = (iso: string | null) => (iso ? ddMon(iso) : "");
      let status: string;
      let tone: Tone;
      let next: string;
      switch (s.status) {
        case "active":
          [status, tone, next] = ["ativa", "ok", `${due(s.nextDueOn)} · ${v === null ? "a combinar" : money(v)}`];
          break;
        case "past_due": // not drawn
          [status, tone, next] = ["atrasada", "danger", `${due(s.nextDueOn)} · ${v === null ? "a combinar" : money(v)}`];
          break;
        case "trial":
          status = days === null ? "teste" : days < 0 ? "teste: acabou" : days === 0 ? "teste: acaba hoje" : `teste: faltam ${days} ${days === 1 ? "dia" : "dias"}`;
          tone = "warn";
          next = s.asaasSubscriptionId && ends ? `${ddMon(ends)} · ${v === null ? "a combinar" : money(v)}` : "sem cartão ainda";
          break;
        case "free":
          [status, tone, next] = ["grátis", "muted", "não cobra"];
          break;
        case "canceled": // not drawn
          [status, tone, next] = ["cancelada", "muted", "não cobra"];
          break;
      }
      return {
        accountId: s.accountId,
        account: label(s.accountId),
        plan: s.status === "trial" ? `${p?.name ?? ""} (teste)` : (p?.name ?? ""),
        units: String(s.unitsBilled),
        status,
        tone,
        next,
        asaas: shortAsaasId(s.asaasSubscriptionId ?? s.asaasCustomerId),
        lastEvent: s.lastEvent ? `${s.lastEvent}${s.lastEventAt ? ` ${ddMon(s.lastEventAt)}` : ""}` : "",
      };
    });

  const today = spDate(now);
  const month = monthOf(today);
  const pilots = input.pilots.map((p): PilotLine => {
    const window = p.startedOn ? pilotWindowInMonth(p.startedOn, month) : { from: month, to: addMonth(month) };
    let next: string;
    if (p.pct === null) next = "a definir";
    else if (!window) next = "assinatura mensal fixa"; // not drawn: after day 60
    else {
      const credited = (input.credited.get(p.accountId) ?? []).filter((c) => c.creditedOn >= window.from && c.creditedOn < window.to).reduce((s, c) => s + c.amountCents, 0);
      next = `${pctLabel(p.pct)} de ${money(credited)} creditados = ${brlCents(pilotChargeCents(credited, p.pct, p.capCents))}`;
    }
    return {
      id: p.id,
      accountId: p.accountId,
      account: label(p.accountId),
      pct: p.pct === null ? "" : pctLabel(p.pct),
      cap: p.capCents === null ? "" : money(p.capCents),
      fixed: p.fixedFromDay61Cents === null ? "" : `${money(p.fixedFromDay61Cents)} por ${unit}`,
      startedOn: p.startedOn ?? "",
      next,
    };
  });

  const active = input.subs.filter((s) => s.status === "active");
  const pilotAccounts = new Set(input.pilots.map((p) => p.accountId));
  return {
    kpis: {
      trial: input.subs.filter((s) => s.status === "trial").length,
      trialDays: lucro?.trialDays ?? 0,
      paying: active.length,
      revenue: money(active.reduce((sum, s) => sum + (value(s) ?? 0), 0)),
      pastDue: input.subs.filter((s) => s.status === "past_due").length,
    },
    unit,
    rows,
    pilots,
    fixedHint: lucro?.priceCents ? `${money(lucro.priceCents)} por ${unit}` : "",
    plans,
    accounts: [...input.accounts].sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({ id: a.id, label: label(a.id), hasPilot: pilotAccounts.has(a.id) })),
    labels: [input.accounts.some((a) => a.isSynthetic) ? "dados fictícios" : null, isSandbox(input.asaas) ? "Asaas sandbox" : null].filter((x): x is string => !!x),
  };
}

/** Service-role read for C15, after requireConsole("billing"). */
export async function loadC15View(db: Db, asaas: AsaasConfig, now: Date): Promise<C15View> {
  const store = new SupabaseBillingStore(db);
  const [plans, pilots, subsRes, accRes] = await Promise.all([
    store.plans(),
    store.pilots(),
    db.from("subscription").select("account_id, plan_id, status, asaas_customer_id, asaas_subscription_id, next_due_on, units_billed, last_event, last_event_at"),
    db.from("account").select("id, code, name, trial_ends_at, is_synthetic, created_at"),
  ]);
  if (subsRes.error) throw new Error(subsRes.error.message);
  if (accRes.error) throw new Error(accRes.error.message);
  const credited = new Map<string, { amountCents: number; creditedOn: string }[]>();
  for (const p of pilots) credited.set(p.accountId, await store.creditedItems(p.accountId, "0000-01-01", "9999-12-31"));
  return buildC15View({
    plans,
    pilots,
    credited,
    asaas,
    now,
    subs: (subsRes.data ?? []).map((r) => ({
      accountId: r.account_id,
      planId: r.plan_id,
      status: r.status,
      asaasCustomerId: r.asaas_customer_id,
      asaasSubscriptionId: r.asaas_subscription_id,
      nextDueOn: r.next_due_on,
      unitsBilled: r.units_billed,
      lastEvent: r.last_event,
      lastEventAt: r.last_event_at ? new Date(r.last_event_at) : null,
    })),
    accounts: (accRes.data ?? []).map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      trialEndsAt: a.trial_ends_at ? new Date(a.trial_ends_at) : null,
      isSynthetic: a.is_synthetic,
      createdAt: a.created_at,
    })),
  });
}
