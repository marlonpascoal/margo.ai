// What billing needs from the database. SupabaseBillingStore implements it; unit tests use FakeBillingStore.
import type { AuditEntry } from "@/lib/notify/store";
import type { BillingEventKind } from "./asaas-parse";
import type { BillingUnit, PlanRow, SubscriptionStatus } from "./rules";

export interface SubscriptionRow {
  accountId: string;
  planId: string;
  status: SubscriptionStatus;
  asaasCustomerId: string | null;
  asaasSubscriptionId: string | null;
  nextDueOn: string | null;
  unitsBilled: number;
  lastEvent: string | null;
  lastEventAt: Date | null;
}

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  trialEndsAt: Date | null;
  isSynthetic: boolean;
}

export type SubscriptionPatch = Partial<Omit<SubscriptionRow, "accountId">>;

export type InvoiceStatus = "pending" | "confirmed" | "overdue" | "refused" | "canceled";

export interface InvoiceUpsert {
  accountId: string;
  asaasPaymentId: string;
  asaasSubscriptionId: string | null;
  dueOn: string | null;
  units: number | null;
  amountCents: number;
  status: InvoiceStatus;
}

export interface StoredEvent {
  id: string;
  /** false when the event id was already stored (a replay). */
  inserted: boolean;
  processed: boolean;
}

export interface PilotRow {
  id: string;
  accountId: string;
  pct: number | null;
  capCents: number | null;
  fixedFromDay61Cents: number | null;
  startedOn: string | null;
  /** yyyy-mm-dd (São Paulo) the pilot was created: day 61 counts from here when the terms are open. */
  createdOn: string;
}

export type PilotChargeStatus = "pending" | "charged" | "no_charge" | "paid" | "refused";

/** pct: share of the credited amount in days 1 to 60. fixed: monthly charge from day 61 (Marlon 31/out). */
export type PilotChargeKind = "pct" | "fixed";

export interface PilotChargeRow {
  id: string;
  pilotId: string;
  kind: PilotChargeKind;
  month: string;
  creditedCents: number;
  chargeCents: number;
  asaasPaymentId: string | null;
  status: PilotChargeStatus | null;
}

/** A contestation marked creditada (C16), with the day the credit showed in the payout. */
export interface CreditedItem {
  amountCents: number;
  creditedOn: string;
}

export interface BillingStore {
  plans(): Promise<PlanRow[]>;
  account(accountId: string): Promise<AccountRow | null>;
  subscription(accountId: string): Promise<SubscriptionRow | null>;
  /** Subscriptions with this status (trial for the trial-end job; any not free for the units job). */
  subscriptionsByStatus(statuses: SubscriptionStatus[]): Promise<SubscriptionRow[]>;
  /** Account of an Asaas customer or subscription id, from the subscription table. */
  accountByAsaasIds(ids: { customerId: string | null; subscriptionId: string | null }): Promise<string | null>;
  updateSubscription(accountId: string, patch: SubscriptionPatch): Promise<void>;
  setAccountPlan(accountId: string, planId: string): Promise<void>;
  /** 04 §7, D28, D40: kitchens in analysis, or channel stores of kitchens in analysis. */
  countUnits(accountId: string, unit: BillingUnit): Promise<number>;
  /** 04 §7: pauses every running import source of the account; returns how many were paused. */
  pauseImportSources(accountId: string, reason: "trial_ended" | "subscription_canceled", at: Date): Promise<number>;
  /** A confirmed payment after a pause: the sources run again. Returns how many resumed. */
  resumeImportSources(accountId: string): Promise<number>;

  /** The first CNPJ of the account and the Dono's e-mail, for the Asaas customer (06 §4). */
  customerData(accountId: string): Promise<{ name: string; cnpj: string; email: string | null } | null>;
  /** 04 §8: the person's own security lock in force blocks their plan changes (not the whole account's). */
  hasActiveLock(accountId: string, personId: string, at: Date): Promise<boolean>;

  /** Stores a raw webhook; a replay (same Asaas event id) returns inserted false and changes nothing. */
  storeEvent(ev: { eventId: string; asaasEvent: string; kind: BillingEventKind; accountId: string | null; payload: unknown }): Promise<StoredEvent>;
  /** Sets processed_at only if still null; false when another delivery got there first. */
  claimEvent(id: string, at: Date): Promise<boolean>;
  /** Undo claimEvent after a failure, so Asaas's retry can process it. */
  releaseEvent(id: string): Promise<void>;
  upsertInvoice(row: InvoiceUpsert): Promise<void>;

  pilots(): Promise<PilotRow[]>;
  creditedItems(accountId: string, from: string, to: string): Promise<CreditedItem[]>;
  pilotCharge(pilotId: string, month: string, kind: PilotChargeKind): Promise<PilotChargeRow | null>;
  pilotChargeById(id: string): Promise<PilotChargeRow | null>;
  /** Inserts the month's row; null when it already exists (unique pilot_id, month, kind). */
  insertPilotCharge(row: Omit<PilotChargeRow, "id">): Promise<string | null>;
  updatePilotCharge(id: string, patch: Partial<Pick<PilotChargeRow, "asaasPaymentId" | "status">>): Promise<void>;

  audit(entries: AuditEntry[]): Promise<void>;
}
