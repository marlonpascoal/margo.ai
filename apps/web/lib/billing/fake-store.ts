// In-memory BillingStore for unit tests. SupabaseBillingStore has its own integration test.
import type { AuditEntry } from "@/lib/notify/store";
import type { BillingEventKind } from "./asaas-parse";
import type { BillingUnit, PlanRow, SubscriptionStatus } from "./rules";
import type {
  AccountRow,
  BillingStore,
  CreditedItem,
  InvoiceUpsert,
  PilotChargeKind,
  PilotChargeRow,
  PilotRow,
  StoredEvent,
  SubscriptionPatch,
  SubscriptionRow,
} from "./store";

export const FAKE_PLANS: PlanRow[] = [
  { id: "plan-raio_x", code: "raio_x", name: "Raio-X", priceCents: 0, billingUnit: "kitchen", trialDays: 14, priceIsExample: true },
  { id: "plan-lucro", code: "lucro", name: "Lucro", priceCents: 30000, billingUnit: "kitchen", trialDays: 14, priceIsExample: true },
  { id: "plan-rede", code: "rede", name: "Rede", priceCents: null, billingUnit: "kitchen", trialDays: 14, priceIsExample: true },
];

export interface FakeSource {
  accountId: string;
  pausedAt: Date | null;
  pausedReason: string | null;
}

export class FakeBillingStore implements BillingStore {
  planRows: PlanRow[] = FAKE_PLANS.map((p) => ({ ...p }));
  accounts: (AccountRow & { planId: string | null })[] = [];
  subs: SubscriptionRow[] = [];
  units = new Map<string, { kitchen: number; channel_store: number }>();
  sources: FakeSource[] = [];
  customers = new Map<string, { name: string; cnpj: string; email: string | null }>();
  locks: { accountId: string; until: Date }[] = [];
  events: { id: string; eventId: string; asaasEvent: string; kind: BillingEventKind; accountId: string | null; payload: unknown; processedAt: Date | null }[] = [];
  invoices: InvoiceUpsert[] = [];
  pilotRows: PilotRow[] = [];
  credited = new Map<string, CreditedItem[]>();
  charges: PilotChargeRow[] = [];
  audits: AuditEntry[] = [];
  private seq = 0;

  addAccount(a: { id: string; code?: string; name?: string; trialEndsAt?: Date | null; status: SubscriptionStatus; plan?: string; synthetic?: boolean; units?: number } & Partial<SubscriptionRow>) {
    const planId = `plan-${a.plan ?? (a.status === "free" ? "raio_x" : "lucro")}`;
    this.accounts.push({ id: a.id, code: a.code ?? a.id, name: a.name ?? `Conta ${a.id}`, trialEndsAt: a.trialEndsAt ?? null, isSynthetic: a.synthetic ?? false, planId });
    this.subs.push({
      accountId: a.id,
      planId,
      status: a.status,
      asaasCustomerId: a.asaasCustomerId ?? null,
      asaasSubscriptionId: a.asaasSubscriptionId ?? null,
      nextDueOn: a.nextDueOn ?? null,
      unitsBilled: a.unitsBilled ?? a.units ?? 1,
      lastEvent: a.lastEvent ?? null,
      lastEventAt: a.lastEventAt ?? null,
    });
    this.units.set(a.id, { kitchen: a.units ?? 1, channel_store: a.units ?? 1 });
    this.sources.push({ accountId: a.id, pausedAt: null, pausedReason: null });
    this.customers.set(a.id, { name: `Empresa ${a.id} Ltda`, cnpj: "11222333000100", email: `dono@${a.id}.local` });
  }

  sub(accountId: string) {
    return this.subs.find((s) => s.accountId === accountId)!;
  }

  async plans() { return this.planRows.map((p) => ({ ...p })); }
  async account(accountId: string) {
    const a = this.accounts.find((x) => x.id === accountId);
    return a ? { id: a.id, code: a.code, name: a.name, trialEndsAt: a.trialEndsAt, isSynthetic: a.isSynthetic } : null;
  }
  async subscription(accountId: string) {
    const s = this.subs.find((x) => x.accountId === accountId);
    return s ? { ...s } : null;
  }
  async subscriptionsByStatus(statuses: SubscriptionStatus[]) { return this.subs.filter((s) => statuses.includes(s.status)).map((s) => ({ ...s })); }
  async accountByAsaasIds(ids: { customerId: string | null; subscriptionId: string | null }) {
    const s = this.subs.find((x) => (ids.subscriptionId && x.asaasSubscriptionId === ids.subscriptionId) || (ids.customerId && x.asaasCustomerId === ids.customerId));
    return s?.accountId ?? null;
  }
  async updateSubscription(accountId: string, patch: SubscriptionPatch) { Object.assign(this.sub(accountId), patch); }
  async setAccountPlan(accountId: string, planId: string) { this.accounts.find((a) => a.id === accountId)!.planId = planId; }
  async countUnits(accountId: string, unit: BillingUnit) { return this.units.get(accountId)?.[unit] ?? 0; }
  async pauseImportSources(accountId: string, reason: "trial_ended" | "subscription_canceled", at: Date) {
    const list = this.sources.filter((s) => s.accountId === accountId && !s.pausedAt);
    list.forEach((s) => Object.assign(s, { pausedAt: at, pausedReason: reason }));
    return list.length;
  }
  async resumeImportSources(accountId: string) {
    const list = this.sources.filter((s) => s.accountId === accountId && s.pausedAt);
    list.forEach((s) => Object.assign(s, { pausedAt: null, pausedReason: null }));
    return list.length;
  }
  async customerData(accountId: string) { return this.customers.get(accountId) ?? null; }
  async hasActiveLock(accountId: string, at: Date) { return this.locks.some((l) => l.accountId === accountId && l.until > at); }

  async storeEvent(ev: { eventId: string; asaasEvent: string; kind: BillingEventKind; accountId: string | null; payload: unknown }): Promise<StoredEvent> {
    const found = this.events.find((e) => e.eventId === ev.eventId);
    if (found) return { id: found.id, inserted: false, processed: found.processedAt !== null };
    const id = `ev-${++this.seq}`;
    this.events.push({ ...ev, id, processedAt: null });
    return { id, inserted: true, processed: false };
  }
  async claimEvent(id: string, at: Date) {
    const e = this.events.find((x) => x.id === id)!;
    if (e.processedAt) return false;
    e.processedAt = at;
    return true;
  }
  async releaseEvent(id: string) { this.events.find((x) => x.id === id)!.processedAt = null; }
  async upsertInvoice(row: InvoiceUpsert) {
    const i = this.invoices.findIndex((x) => x.asaasPaymentId === row.asaasPaymentId);
    if (i >= 0) this.invoices[i] = row;
    else this.invoices.push(row);
  }

  async pilots() { return this.pilotRows.map((p) => ({ ...p })); }
  async creditedItems(accountId: string, from: string, to: string) {
    return (this.credited.get(accountId) ?? []).filter((c) => c.creditedOn >= from && c.creditedOn < to);
  }
  async pilotCharge(pilotId: string, month: string, kind: PilotChargeKind) {
    return this.charges.find((c) => c.pilotId === pilotId && c.month === month && c.kind === kind) ?? null;
  }
  async pilotChargeById(id: string) { return this.charges.find((c) => c.id === id) ?? null; }
  async insertPilotCharge(row: Omit<PilotChargeRow, "id">) {
    if (this.charges.some((c) => c.pilotId === row.pilotId && c.month === row.month && c.kind === row.kind)) return null;
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
    this.charges.push({ ...row, id });
    return id;
  }
  async updatePilotCharge(id: string, patch: Partial<Pick<PilotChargeRow, "asaasPaymentId" | "status">>) {
    Object.assign(this.charges.find((c) => c.id === id)!, patch);
  }
  async audit(entries: AuditEntry[]) { this.audits.push(...entries); }
}
