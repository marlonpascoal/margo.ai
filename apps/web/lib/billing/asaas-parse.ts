// The parser boundary of the Asaas webhook (06 §4): one Asaas event in, one internal event out.
// Everything after this file works on BillingEventIn only, so its tests build internal events and never
// invent Asaas bodies. This parser is tested against sandbox recordings in fixtures/asaas/ (README there);
// until they exist those tests are skipped.

/** Internal event types. 06 §4 handles payment confirmed, overdue, refused and subscription deleted. */
export type BillingEventKind =
  | "payment_confirmed"
  | "payment_overdue"
  | "payment_refused"
  /** Not listed in 06 §4, needed for 04 §7: a checkout made during the trial creates the subscription
   *  long before its first payment, and the trial-end job must not return that account to free. */
  | "subscription_created"
  | "subscription_deleted"
  | "unknown";

export interface BillingEventIn {
  /** Asaas event id, the dedupe key of billing_event. */
  eventId: string;
  /** Asaas event name as received (PAYMENT_CONFIRMED, ...). */
  asaasEvent: string;
  kind: BillingEventKind;
  customerId: string | null;
  subscriptionId: string | null;
  paymentId: string | null;
  /** Payment or subscription value, centavos. */
  valueCents: number | null;
  /** Payment due date (yyyy-mm-dd), or the subscription's next due date. */
  dueDate: string | null;
  externalReference: string | null;
}

/** Asaas event name to internal kind. Names from the Asaas webhook documentation (06 §4). */
const KIND: Record<string, BillingEventKind> = {
  PAYMENT_CONFIRMED: "payment_confirmed",
  PAYMENT_RECEIVED: "payment_confirmed",
  PAYMENT_OVERDUE: "payment_overdue",
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "payment_refused",
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: "payment_refused",
  SUBSCRIPTION_CREATED: "subscription_created",
  SUBSCRIPTION_DELETED: "subscription_deleted",
};

export class UnparsableEvent extends Error {}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const date = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const cents = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);

/** Raw body to internal event. Throws UnparsableEvent when there is no event id or name to store. */
export function parseAsaasEvent(raw: unknown): BillingEventIn {
  const body = obj(raw);
  const eventId = str(body?.id);
  const asaasEvent = str(body?.event);
  if (!body || !eventId || !asaasEvent) throw new UnparsableEvent("event without id or name");
  const kind = KIND[asaasEvent] ?? "unknown";
  const payment = obj(body.payment);
  const subscription = obj(body.subscription);
  if (payment) {
    return {
      eventId,
      asaasEvent,
      kind: asaasEvent.startsWith("PAYMENT_") ? kind : "unknown",
      customerId: str(payment.customer),
      subscriptionId: str(payment.subscription),
      paymentId: str(payment.id),
      valueCents: cents(payment.value),
      dueDate: date(payment.dueDate),
      externalReference: str(payment.externalReference),
    };
  }
  if (subscription) {
    return {
      eventId,
      asaasEvent,
      kind: asaasEvent.startsWith("SUBSCRIPTION_") ? kind : "unknown",
      customerId: str(subscription.customer),
      subscriptionId: str(subscription.id),
      paymentId: null,
      valueCents: cents(subscription.value),
      dueDate: date(subscription.nextDueDate),
      externalReference: str(subscription.externalReference),
    };
  }
  return { eventId, asaasEvent, kind: "unknown", customerId: null, subscriptionId: null, paymentId: null, valueCents: null, dueDate: null, externalReference: null };
}
