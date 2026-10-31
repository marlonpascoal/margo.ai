// /api/asaas/webhook (06 §4, D27): authenticate, store raw in billing_event, dedupe by event id, then
// update the subscription. Subscription status changes only here (D27), except the 04 §7 return to free.
import { timingSafeEqual } from "node:crypto";
import { notify } from "@/lib/notify/outbox";
import { raiseAlert } from "@/lib/notify/alerts";
import { parseAsaasEvent, UnparsableEvent, type BillingEventIn } from "./asaas-parse";
import { addMonth } from "./rules";
import {
  ALERT_TITLES,
  auditSubscription,
  billingResultMessage,
  C15_PATH,
  planByCode,
  returnToFree,
  systemAudit,
  type BillingDeps,
} from "./service";
import type { InvoiceStatus } from "./store";

export type WebhookOutcome = "unauthorized" | "bad_request" | "duplicate" | "ignored" | "unmatched" | "applied" | "error";

export interface WebhookResult {
  status: 200 | 400 | 401 | 500;
  outcome: WebhookOutcome;
}

/** Constant-time comparison; a missing ASAAS_WEBHOOK_TOKEN refuses everything. */
export function tokenMatches(received: string | null, expected: string | null | undefined): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PILOT_REF = /^pilot_charge:([0-9a-f-]{36})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The account an event belongs to: by Asaas ids first, then by our externalReference. */
async function matchAccount(deps: BillingDeps, ev: BillingEventIn): Promise<string | null> {
  const byIds = await deps.store.accountByAsaasIds({ customerId: ev.customerId, subscriptionId: ev.subscriptionId });
  if (byIds) return byIds;
  const ref = ev.externalReference;
  if (!ref) return null;
  const pilot = PILOT_REF.exec(ref);
  if (pilot) {
    const charge = await deps.store.pilotChargeById(pilot[1]);
    if (!charge) return null;
    return (await deps.store.pilots()).find((p) => p.id === charge.pilotId)?.accountId ?? null;
  }
  if (UUID.test(ref) && (await deps.store.account(ref))) return ref;
  return null;
}

/**
 * One delivery. `parse` is the parser boundary (asaas-parse.ts); tests pass their own so no Asaas body
 * is invented. Replays of a processed event change nothing (C15 "Done when", E01).
 */
export async function handleAsaasWebhook(
  deps: BillingDeps,
  req: { token: string | null; rawBody: string },
  expectedToken: string | null | undefined,
  parse: (raw: unknown) => BillingEventIn = parseAsaasEvent,
): Promise<WebhookResult> {
  if (!tokenMatches(req.token, expectedToken)) return { status: 401, outcome: "unauthorized" };
  let raw: unknown;
  let ev: BillingEventIn;
  try {
    raw = JSON.parse(req.rawBody);
    ev = parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof UnparsableEvent) return { status: 400, outcome: "bad_request" };
    throw err;
  }
  const accountId = await matchAccount(deps, ev);
  const stored = await deps.store.storeEvent({ eventId: ev.eventId, asaasEvent: ev.asaasEvent, kind: ev.kind, accountId, payload: raw });
  if (stored.processed) return { status: 200, outcome: "duplicate" };
  // Unknown events are stored and ignored (06 §4); unmatched ones wait in billing_event for a founder.
  if (ev.kind === "unknown") return { status: 200, outcome: "ignored" };
  if (!accountId) return { status: 200, outcome: "unmatched" };
  if (!(await deps.store.claimEvent(stored.id, deps.now()))) return { status: 200, outcome: "duplicate" };
  try {
    await applyBillingEvent(deps, ev, accountId);
  } catch (err) {
    await deps.store.releaseEvent(stored.id);
    console.error(JSON.stringify({ service: "asaas_webhook", event: ev.asaasEvent, error: String(err) }));
    return { status: 500, outcome: "error" };
  }
  return { status: 200, outcome: "applied" };
}

const INVOICE_STATUS: Partial<Record<BillingEventIn["kind"], InvoiceStatus>> = {
  payment_confirmed: "confirmed",
  payment_overdue: "overdue",
  payment_refused: "refused",
};

/** The state transitions of 04 §7 and 06 §4, on an internal event already matched to an account. */
export async function applyBillingEvent(deps: BillingDeps, ev: BillingEventIn, accountId: string): Promise<void> {
  const { store } = deps;
  const at = deps.now();

  const pilot = ev.externalReference ? PILOT_REF.exec(ev.externalReference) : null;
  if (pilot) return applyPilotPayment(deps, ev, accountId, pilot[1]);

  const before = await store.subscription(accountId);
  if (!before) throw new Error(`account ${accountId} has no subscription`);

  const invoiceStatus = INVOICE_STATUS[ev.kind];
  if (invoiceStatus && ev.paymentId && ev.valueCents !== null) {
    await store.upsertInvoice({
      accountId,
      asaasPaymentId: ev.paymentId,
      asaasSubscriptionId: ev.subscriptionId,
      dueOn: ev.dueDate,
      units: before.unitsBilled,
      amountCents: ev.valueCents,
      status: invoiceStatus,
    });
  }

  switch (ev.kind) {
    case "subscription_created": {
      await store.updateSubscription(accountId, { asaasSubscriptionId: ev.subscriptionId, nextDueOn: ev.dueDate ?? before.nextDueOn, lastEvent: "assinatura criada", lastEventAt: at });
      break;
    }
    case "payment_confirmed": {
      // A payment outside a subscription and not a pilot charge has nothing to change here.
      if (!ev.subscriptionId) break;
      const lucro = await planByCode(store, "lucro");
      await store.updateSubscription(accountId, {
        status: "active",
        planId: lucro.id,
        asaasSubscriptionId: ev.subscriptionId,
        nextDueOn: ev.dueDate ? addMonth(ev.dueDate) : before.nextDueOn,
        lastEvent: "pagamento confirmado",
        lastEventAt: at,
      });
      await store.setAccountPlan(accountId, lucro.id);
      const resumed = await store.resumeImportSources(accountId);
      if (resumed > 0) await store.audit([systemAudit(accountId, "import_source.resume", "import_source", null, null, { sources: resumed })]);
      await notify(deps.notify, { code: "billing_result", accountId, message: billingResultMessage(true, ev.valueCents, `plano ${lucro.name}`) });
      break;
    }
    case "payment_overdue": {
      // Only a subscription that exists at Asaas can be overdue.
      if (!before.asaasSubscriptionId && before.status !== "active") break;
      await store.updateSubscription(accountId, { status: "past_due", lastEvent: "pagamento atrasado", lastEventAt: at });
      break;
    }
    case "payment_refused": {
      // A refused card on a running subscription makes it past due; during the trial the status stays.
      await store.updateSubscription(accountId, { status: before.status === "active" ? "past_due" : before.status, lastEvent: "cobrança recusada", lastEventAt: at });
      await notify(deps.notify, { code: "billing_result", accountId, message: billingResultMessage(false, ev.valueCents, "plano Lucro") });
      await raiseAlert(deps.notify, "urgente", ALERT_TITLES.refused, accountId, C15_PATH);
      break;
    }
    case "subscription_deleted": {
      // Only the subscription we know; a stale id from an earlier checkout changes nothing.
      if (before.asaasSubscriptionId && ev.subscriptionId && before.asaasSubscriptionId !== ev.subscriptionId) break;
      await returnToFree(deps, accountId, "subscription_canceled", "assinatura cancelada");
      return;
    }
    case "unknown":
      return;
  }
  await auditSubscription(deps, accountId, `subscription.webhook.${ev.kind}`, before);
}

/** D37 pilot charges: single payments whose externalReference names the pilot_charge row. */
async function applyPilotPayment(deps: BillingDeps, ev: BillingEventIn, accountId: string, chargeId: string) {
  const { store } = deps;
  const charge = await store.pilotChargeById(chargeId);
  if (!charge) return;
  const status = ev.kind === "payment_confirmed" ? "paid" : ev.kind === "payment_refused" ? "refused" : null;
  if (!status) return;
  await store.updatePilotCharge(chargeId, { status, asaasPaymentId: charge.asaasPaymentId ?? ev.paymentId });
  await store.audit([systemAudit(accountId, `pilot_charge.webhook.${ev.kind}`, "pilot_charge", chargeId, { status: charge.status }, { status })]);
  await notify(deps.notify, { code: "billing_result", accountId, message: billingResultMessage(status === "paid", ev.valueCents, "piloto") });
  if (status === "refused") await raiseAlert(deps.notify, "urgente", ALERT_TITLES.refused, accountId, C15_PATH);
}
