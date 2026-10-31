// P09/W05 actions of the Dono (04 §7, 06 §4). The caller has already checked the session and the Dono role
// server-side (access.ts); every write here goes to audit_log with the person, ip and user agent.
import { raiseAlert } from "@/lib/notify/alerts";
import type { RequestMeta } from "@/lib/notify/store";
import { firstDueDate, monthlyTotalCents, unitWord } from "./rules";
import { ALERT_TITLES, C15_PATH, CustomerDataMissing, ensureCustomer, planByCode, type BillingDeps } from "./service";

export interface OwnerActor extends RequestMeta {
  personId: string;
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; message: string };

/** Not drawn; short, in the drawings' voice. */
export const CHECKOUT_MESSAGES = {
  locked: "Mudanças de plano ficam bloqueadas por 24 horas depois de uma troca de contato.",
  alreadyLucro: "Sua conta já tem o plano Lucro.",
  noUnits: (word: string) => `Escolha ao menos uma ${word} para a análise antes de assinar.`,
  noCompany: "Cadastre o CNPJ da empresa antes de assinar.",
  unavailable: "Não conseguimos abrir o pagamento agora. Tente de novo em alguns minutos.",
  redeSent: "Recebemos o pedido. Os fundadores falam com você em breve.",
} as const;

/** Where Asaas sends the person back (05 P10): /app/plano?status=... */
export function returnUrls(origin: string) {
  const base = `${origin.replace(/\/+$/, "")}/app/plano`;
  return { successUrl: `${base}?status=sucesso`, cancelUrl: `${base}?status=cancelado`, expiredUrl: `${base}?status=expirado` };
}

/**
 * "Assinar pelo Asaas": creates the Asaas customer if needed and a hosted checkout, recurring, card only,
 * monthly value = units x price, first due date = trial end when converting during the trial (06 §4).
 * The subscription status does not change here; only the webhook moves it (D27).
 */
export async function startCheckout(deps: BillingDeps, actor: OwnerActor, accountId: string, origin: string): Promise<CheckoutResult> {
  const { store } = deps;
  const now = deps.now();
  if (await store.hasActiveLock(accountId, now)) return { ok: false, message: CHECKOUT_MESSAGES.locked };
  const sub = await store.subscription(accountId);
  const account = await store.account(accountId);
  if (!sub || !account) throw new Error(`account ${accountId} has no subscription`);
  const lucro = await planByCode(store, "lucro");
  if (sub.asaasSubscriptionId || ((sub.status === "active" || sub.status === "past_due") && sub.planId === lucro.id)) {
    return { ok: false, message: CHECKOUT_MESSAGES.alreadyLucro };
  }
  const units = await store.countUnits(accountId, lucro.billingUnit);
  if (units === 0) return { ok: false, message: CHECKOUT_MESSAGES.noUnits(unitWord(lucro.billingUnit, 1)) };
  const value = monthlyTotalCents(lucro, units);
  if (value === null) throw new Error("plan lucro without price");

  const who = { actorPersonId: actor.personId, actorKind: "person" as const, ip: actor.ip, userAgent: actor.userAgent };
  let customerId: string;
  try {
    customerId = await ensureCustomer(deps, accountId, who);
  } catch (err) {
    if (err instanceof CustomerDataMissing) return { ok: false, message: CHECKOUT_MESSAGES.noCompany };
    console.error(JSON.stringify({ service: "billing_checkout", step: "customer", error: String(err) }));
    return { ok: false, message: CHECKOUT_MESSAGES.unavailable };
  }
  const nextDueDate = firstDueDate(account.trialEndsAt, sub.status, now);
  let checkout: { id: string; url: string };
  try {
    checkout = await deps.asaas.createCheckout({
      customerId,
      valueCents: value,
      nextDueDate,
      itemName: `MargoAI · plano ${lucro.name}`,
      itemDescription: `${units} ${unitWord(lucro.billingUnit, units)} · cobrança mensal no cartão`,
      ...returnUrls(origin),
      externalReference: accountId,
    });
  } catch (err) {
    console.error(JSON.stringify({ service: "billing_checkout", step: "checkout", error: String(err) }));
    return { ok: false, message: CHECKOUT_MESSAGES.unavailable };
  }
  if (units !== sub.unitsBilled) await store.updateSubscription(accountId, { unitsBilled: units });
  await store.audit([
    {
      ...who,
      accountId,
      action: "subscription.checkout_start",
      entity: "subscription",
      entityId: accountId,
      before: { status: sub.status, units_billed: sub.unitsBilled },
      after: { checkout_id: checkout.id, plan: lucro.code, units, value_cents: value, next_due_date: nextDueDate },
    },
  ]);
  return { ok: true, url: checkout.url };
}

/** "Falar com a gente" (Rede): an alert for the founders, no checkout (04 §7). Repeated clicks raise one alert. */
export async function requestRede(deps: BillingDeps, actor: OwnerActor, accountId: string): Promise<{ message: string }> {
  const { id, created } = await raiseAlert(deps.notify, "medio", ALERT_TITLES.rede, accountId, C15_PATH);
  await deps.store.audit([
    {
      actorPersonId: actor.personId,
      actorKind: "person",
      accountId,
      action: "subscription.request_rede",
      entity: "alert",
      entityId: id,
      before: null,
      after: { alert_id: id, new_alert: created },
      ip: actor.ip,
      userAgent: actor.userAgent,
    },
  ]);
  return { message: CHECKOUT_MESSAGES.redeSent };
}
