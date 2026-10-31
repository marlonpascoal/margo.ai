// Shared billing steps (04 §7, 06 §4): dependencies, the Asaas customer, returning an account to free,
// and the billing notices (04 §9 trial_ending, billing_result) through the existing notifier.
import type { AlertConfig } from "@/lib/notify/alerts";
import type { NotifyDeps } from "@/lib/notify/outbox";
import type { NoticeMessage } from "@/lib/notify/plan";
import type { AuditEntry } from "@/lib/notify/store";
import { brlCents } from "@/lib/m2/format";
import type { AsaasClient } from "./asaas";
import { ddMon, type PlanCode, type PlanRow } from "./rules";
import type { BillingStore, SubscriptionRow } from "./store";

export interface BillingDeps {
  store: BillingStore;
  asaas: AsaasClient;
  /** The notifier and team alerts (lib/notify). */
  notify: NotifyDeps & { config: AlertConfig };
  now: () => Date;
}

export const PLAN_PATH = "/app/plano";
export const C15_PATH = "/console/assinaturas";

export async function planByCode(store: BillingStore, code: PlanCode): Promise<PlanRow> {
  const plan = (await store.plans()).find((p) => p.code === code);
  if (!plan) throw new Error(`plan ${code} missing`);
  return plan;
}

export const systemAudit = (accountId: string, action: string, entity: string, entityId: string | null, before: unknown, after: unknown): AuditEntry => ({
  actorPersonId: null,
  actorKind: "system",
  accountId,
  action,
  entity,
  entityId,
  before,
  after,
  ip: null,
  userAgent: null,
});

const subscriptionAudit = (s: SubscriptionRow | null) =>
  s && { status: s.status, plan_id: s.planId, asaas_subscription_id: s.asaasSubscriptionId, units_billed: s.unitsBilled, next_due_on: s.nextDueOn };

/** Audits a subscription change made by the system (webhook or job): before and after. */
export async function auditSubscription(deps: BillingDeps, accountId: string, action: string, before: SubscriptionRow | null) {
  const after = await deps.store.subscription(accountId);
  await deps.store.audit([systemAudit(accountId, action, "subscription", accountId, subscriptionAudit(before), subscriptionAudit(after))]);
}

export class CustomerDataMissing extends Error {}

/** 06 §4: the Asaas customer is created when the Dono chooses a paid plan (name, CNPJ, e-mail). */
export async function ensureCustomer(deps: BillingDeps, accountId: string, actor: Omit<AuditEntry, "accountId" | "action" | "entity" | "entityId" | "before" | "after">): Promise<string> {
  const sub = await deps.store.subscription(accountId);
  if (!sub) throw new Error(`account ${accountId} has no subscription`);
  if (sub.asaasCustomerId) return sub.asaasCustomerId;
  const data = await deps.store.customerData(accountId);
  if (!data) throw new CustomerDataMissing(accountId);
  const { id } = await deps.asaas.createCustomer({ name: data.name, cpfCnpj: data.cnpj, email: data.email, externalReference: accountId });
  await deps.store.updateSubscription(accountId, { asaasCustomerId: id });
  await deps.store.audit([
    { ...actor, accountId, action: "subscription.asaas_customer", entity: "subscription", entityId: accountId, before: { asaas_customer_id: null }, after: { asaas_customer_id: id } },
  ]);
  return id;
}

/**
 * 04 §7: "subscription.status=free, plan Raio-X; channel imports stop (sources paused), data kept".
 * A deleted Asaas subscription lands in the same place with status canceled.
 */
export async function returnToFree(deps: BillingDeps, accountId: string, why: "trial_ended" | "subscription_canceled", lastEvent: string) {
  const { store } = deps;
  const before = await store.subscription(accountId);
  const raioX = await planByCode(store, "raio_x");
  const at = deps.now();
  await store.updateSubscription(accountId, {
    status: why === "trial_ended" ? "free" : "canceled",
    planId: raioX.id,
    asaasSubscriptionId: null,
    nextDueOn: null,
    lastEvent,
    lastEventAt: at,
  });
  await store.setAccountPlan(accountId, raioX.id);
  const paused = await store.pauseImportSources(accountId, why, at);
  await auditSubscription(deps, accountId, why === "trial_ended" ? "subscription.trial_end" : "subscription.canceled", before);
  if (paused > 0) await store.audit([systemAudit(accountId, "import_source.pause", "import_source", null, null, { reason: why, sources: paused })]);
}

// 04 §9 notices. Not drawn: plain text in the style of the drawn e-mails, no em dashes. ----------------

export function trialEndingMessage(which: "d3" | "d0", endsOn: Date): NoticeMessage {
  const when = which === "d0" ? "hoje" : `em 3 dias, no dia ${ddMon(endsOn)}`;
  return {
    subject: which === "d0" ? "Seu teste grátis acaba hoje" : "Seu teste grátis acaba em 3 dias",
    body: [
      `O teste grátis da MargoAI acaba ${when}.`,
      `Para continuar com o fechamento por canal e as diferenças no repasse, escolha um plano: ${PLAN_PATH}`,
      "Se não escolher, a conta volta para o Raio-X grátis e os dados de canal param de atualizar. Nada é cobrado.",
    ].join("\n"),
    whatsapp: `MargoAI: seu teste grátis acaba ${when}. Escolha um plano em ${PLAN_PATH}. Sem plano, a conta volta para o grátis e nada é cobrado.`,
  };
}

export function billingResultMessage(approved: boolean, valueCents: number | null, what: string): NoticeMessage {
  const value = valueCents === null ? "" : ` de ${brlCents(valueCents)}`;
  return approved
    ? { subject: "Cobrança aprovada", body: `A cobrança${value} (${what}) foi aprovada no cartão.\nFaturas: ${PLAN_PATH}` }
    : {
        subject: "Cobrança recusada",
        body: `A cobrança${value} (${what}) foi recusada no cartão.\nConfira o cartão no Asaas pela fatura ou fale com a gente. Faturas: ${PLAN_PATH}`,
      };
}

/** 04 §10 titles. "Cobrança recusada no cartão" and "Teste grátis acaba em 2 dias, sem plano" are drawn (C21). */
export const ALERT_TITLES = {
  refused: "Cobrança recusada no cartão",
  trialEnding: "Teste grátis acaba em 2 dias, sem plano",
  // Not drawn.
  rede: "Pediu o plano Rede",
  pilotNotSent: "Cobrança do piloto não foi criada no Asaas",
  unitsZero: "Assinatura sem cozinha ou loja na análise",
} as const;
