// BillingStore over Postgres with the service role, after the caller's permission check (02 §5).
// Covered by billing.int.test.ts on the local stack.
import type { Database, Json } from "@margoai/contracts";
import { SupabaseNotifyStore } from "@/lib/notify/supabase-store";
import type { AuditEntry } from "@/lib/notify/store";
import type { Db } from "@/lib/supabase/admin";
import type { BillingEventKind } from "./asaas-parse";
import { spDate, type BillingUnit, type PlanRow, type SubscriptionStatus } from "./rules";
import type { AccountRow, BillingStore, InvoiceUpsert, PilotChargeKind, PilotChargeRow, PilotChargeStatus, PilotRow, StoredEvent, SubscriptionPatch, SubscriptionRow } from "./store";

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
function must<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  const data = check(res);
  if (data === null || data === undefined) throw new Error("query returned no data");
  return data;
}

const SUB_COLUMNS = "account_id, plan_id, status, asaas_customer_id, asaas_subscription_id, next_due_on, units_billed, last_event, last_event_at";

type SubDb = {
  account_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  next_due_on: string | null;
  units_billed: number;
  last_event: string | null;
  last_event_at: string | null;
};

const toSub = (r: SubDb): SubscriptionRow => ({
  accountId: r.account_id,
  planId: r.plan_id,
  status: r.status,
  asaasCustomerId: r.asaas_customer_id,
  asaasSubscriptionId: r.asaas_subscription_id,
  nextDueOn: r.next_due_on,
  unitsBilled: r.units_billed,
  lastEvent: r.last_event,
  lastEventAt: r.last_event_at ? new Date(r.last_event_at) : null,
});

export const toPlan = (p: {
  id: string;
  code: string;
  name: string;
  price_cents: number | null;
  billing_unit: BillingUnit;
  trial_days: number;
  price_is_example: boolean;
  competitor_xrays_per_month: number;
}): PlanRow => ({
  id: p.id,
  code: p.code,
  name: p.name,
  priceCents: p.price_cents,
  billingUnit: p.billing_unit,
  trialDays: p.trial_days,
  priceIsExample: p.price_is_example,
  competitorXraysPerMonth: p.competitor_xrays_per_month,
});

export const PLAN_COLUMNS = "id, code, name, price_cents, billing_unit, trial_days, price_is_example, competitor_xrays_per_month";

const PLAN_ORDER = ["raio_x", "lucro", "rede"];

const toCharge = (r: {
  id: string;
  pilot_id: string;
  kind: string;
  month: string;
  credited_cents: number;
  charge_cents: number;
  asaas_payment_id: string | null;
  status: string | null;
}): PilotChargeRow => ({
  id: r.id,
  pilotId: r.pilot_id,
  kind: r.kind as PilotChargeKind,
  month: r.month,
  creditedCents: r.credited_cents,
  chargeCents: r.charge_cents,
  asaasPaymentId: r.asaas_payment_id,
  status: r.status as PilotChargeStatus | null,
});
const CHARGE_COLUMNS = "id, pilot_id, kind, month, credited_cents, charge_cents, asaas_payment_id, status";

export class SupabaseBillingStore implements BillingStore {
  private readonly audits: SupabaseNotifyStore;

  constructor(private readonly db: Db) {
    this.audits = new SupabaseNotifyStore(db);
  }

  async plans() {
    const rows = must(await this.db.from("plan").select(PLAN_COLUMNS));
    return rows.map(toPlan).sort((a, b) => PLAN_ORDER.indexOf(a.code) - PLAN_ORDER.indexOf(b.code));
  }

  async account(accountId: string): Promise<AccountRow | null> {
    const a = check(await this.db.from("account").select("id, code, name, trial_ends_at, is_synthetic").eq("id", accountId).maybeSingle());
    return a ? { id: a.id, code: a.code, name: a.name, trialEndsAt: a.trial_ends_at ? new Date(a.trial_ends_at) : null, isSynthetic: a.is_synthetic } : null;
  }

  async subscription(accountId: string) {
    const r = check(await this.db.from("subscription").select(SUB_COLUMNS).eq("account_id", accountId).maybeSingle());
    return r ? toSub(r) : null;
  }

  async subscriptionsByStatus(statuses: SubscriptionStatus[]) {
    return must(await this.db.from("subscription").select(SUB_COLUMNS).in("status", statuses).order("created_at")).map(toSub);
  }

  async accountByAsaasIds(ids: { customerId: string | null; subscriptionId: string | null }) {
    for (const [column, value] of [["asaas_subscription_id", ids.subscriptionId], ["asaas_customer_id", ids.customerId]] as const) {
      if (!value) continue;
      const r = check(await this.db.from("subscription").select("account_id").eq(column, value).limit(1).maybeSingle());
      if (r) return r.account_id;
    }
    return null;
  }

  async updateSubscription(accountId: string, patch: SubscriptionPatch) {
    const row: Database["public"]["Tables"]["subscription"]["Update"] = {};
    if (patch.planId !== undefined) row.plan_id = patch.planId;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.asaasCustomerId !== undefined) row.asaas_customer_id = patch.asaasCustomerId;
    if (patch.asaasSubscriptionId !== undefined) row.asaas_subscription_id = patch.asaasSubscriptionId;
    if (patch.nextDueOn !== undefined) row.next_due_on = patch.nextDueOn;
    if (patch.unitsBilled !== undefined) row.units_billed = patch.unitsBilled;
    if (patch.lastEvent !== undefined) row.last_event = patch.lastEvent;
    if (patch.lastEventAt !== undefined) row.last_event_at = patch.lastEventAt?.toISOString() ?? null;
    check(await this.db.from("subscription").update(row).eq("account_id", accountId));
  }

  async setAccountPlan(accountId: string, planId: string) {
    check(await this.db.from("account").update({ plan_id: planId }).eq("id", accountId));
  }

  /** 04 §7, D28, D40: kitchens with in_analysis, or channel stores of kitchens with in_analysis. */
  async countUnits(accountId: string, unit: BillingUnit) {
    const kitchens = must(await this.db.from("kitchen").select("id").eq("account_id", accountId).eq("in_analysis", true)).map((k) => k.id);
    if (unit === "kitchen" || kitchens.length === 0) return kitchens.length;
    const { count, error } = await this.db.from("channel_store").select("id", { count: "exact", head: true }).eq("account_id", accountId).in("kitchen_id", kitchens);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async pauseImportSources(accountId: string, reason: "trial_ended" | "subscription_canceled", at: Date) {
    const rows = must(
      await this.db.from("import_source").update({ paused_at: at.toISOString(), paused_reason: reason }).eq("account_id", accountId).is("paused_at", null).select("id"),
    );
    return rows.length;
  }

  async resumeImportSources(accountId: string) {
    const rows = must(await this.db.from("import_source").update({ paused_at: null, paused_reason: null }).eq("account_id", accountId).not("paused_at", "is", null).select("id"));
    return rows.length;
  }

  async customerData(accountId: string) {
    const company = check(await this.db.from("company").select("cnpj, legal_name").eq("account_id", accountId).order("created_at").limit(1).maybeSingle());
    if (!company) return null;
    const dono = check(
      await this.db.from("membership").select("person(email)").eq("account_id", accountId).eq("role", "dono").order("created_at").limit(1).maybeSingle(),
    );
    return { name: company.legal_name, cnpj: company.cnpj, email: dono?.person?.email ?? null };
  }

  async hasActiveLock(accountId: string, at: Date) {
    const { count, error } = await this.db.from("security_lock").select("id", { count: "exact", head: true }).eq("account_id", accountId).gt("until", at.toISOString());
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async storeEvent(ev: { eventId: string; asaasEvent: string; kind: BillingEventKind; accountId: string | null; payload: unknown }): Promise<StoredEvent> {
    const inserted = must(
      await this.db
        .from("billing_event")
        .upsert(
          { asaas_event_id: ev.eventId, asaas_event: ev.asaasEvent, kind: ev.kind, account_id: ev.accountId, payload: (ev.payload ?? {}) as Json & object },
          { onConflict: "asaas_event_id", ignoreDuplicates: true },
        )
        .select("id"),
    );
    if (inserted.length > 0) return { id: inserted[0].id, inserted: true, processed: false };
    const found = must(await this.db.from("billing_event").select("id, processed_at").eq("asaas_event_id", ev.eventId).single());
    return { id: found.id, inserted: false, processed: found.processed_at !== null };
  }

  async claimEvent(id: string, at: Date) {
    const rows = must(await this.db.from("billing_event").update({ processed_at: at.toISOString() }).eq("id", id).is("processed_at", null).select("id"));
    return rows.length === 1;
  }

  async releaseEvent(id: string) {
    check(await this.db.from("billing_event").update({ processed_at: null }).eq("id", id));
  }

  async upsertInvoice(row: InvoiceUpsert) {
    check(
      await this.db.from("billing_invoice").upsert(
        {
          account_id: row.accountId,
          asaas_payment_id: row.asaasPaymentId,
          asaas_subscription_id: row.asaasSubscriptionId,
          due_on: row.dueOn,
          units: row.units,
          amount_cents: row.amountCents,
          status: row.status,
        },
        { onConflict: "asaas_payment_id" },
      ),
    );
  }

  async pilots(): Promise<PilotRow[]> {
    const rows = must(await this.db.from("pilot").select("id, account_id, pct_months_1_2, cap_cents, fixed_from_day_61_cents, started_on, created_at").order("created_at"));
    return rows.map((p) => ({
      id: p.id,
      accountId: p.account_id,
      pct: p.pct_months_1_2 === null ? null : Number(p.pct_months_1_2),
      capCents: p.cap_cents,
      fixedFromDay61Cents: p.fixed_from_day_61_cents,
      startedOn: p.started_on,
      createdOn: spDate(new Date(p.created_at)),
    }));
  }

  /** C16 creditada: the difference amount, on the day the credit entry showed (else the day it was marked). */
  async creditedItems(accountId: string, from: string, to: string) {
    const rows = must(
      await this.db
        .from("contestation")
        .select("marked_at, difference(amount_cents), ledger_entry!contestation_credited_entry_id_fkey(entry_date)")
        .eq("account_id", accountId)
        .eq("status", "creditada"),
    );
    return rows
      .map((r) => ({
        amountCents: r.difference?.amount_cents ?? 0,
        creditedOn: r.ledger_entry?.entry_date ?? (r.marked_at ? spDate(new Date(r.marked_at)) : ""),
      }))
      .filter((c) => c.creditedOn >= from && c.creditedOn < to);
  }

  async pilotCharge(pilotId: string, month: string, kind: PilotChargeKind) {
    const r = check(await this.db.from("pilot_charge").select(CHARGE_COLUMNS).eq("pilot_id", pilotId).eq("month", month).eq("kind", kind).maybeSingle());
    return r ? toCharge(r) : null;
  }

  async pilotChargeById(id: string) {
    const r = check(await this.db.from("pilot_charge").select(CHARGE_COLUMNS).eq("id", id).maybeSingle());
    return r ? toCharge(r) : null;
  }

  async insertPilotCharge(row: Omit<PilotChargeRow, "id">) {
    const rows = must(
      await this.db
        .from("pilot_charge")
        .upsert(
          {
            pilot_id: row.pilotId,
            kind: row.kind,
            month: row.month,
            credited_cents: row.creditedCents,
            charge_cents: row.chargeCents,
            asaas_payment_id: row.asaasPaymentId,
            status: row.status,
          },
          { onConflict: "pilot_id,month,kind", ignoreDuplicates: true },
        )
        .select("id"),
    );
    return rows[0]?.id ?? null;
  }

  async updatePilotCharge(id: string, patch: Partial<Pick<PilotChargeRow, "asaasPaymentId" | "status">>) {
    const row: Database["public"]["Tables"]["pilot_charge"]["Update"] = {};
    if (patch.asaasPaymentId !== undefined) row.asaas_payment_id = patch.asaasPaymentId;
    if (patch.status !== undefined) row.status = patch.status;
    check(await this.db.from("pilot_charge").update(row).eq("id", id));
  }

  async audit(entries: AuditEntry[]) {
    await this.audits.audit(entries);
  }
}
