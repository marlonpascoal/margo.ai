// Billing jobs (04 §7, 04 §9, 06 §4, D37). Quick database updates plus a few Asaas calls, so they run in the
// web app from Vercel Cron (02 §4.3) through /api/cron/billing, once a day. Every job is idempotent: a
// second run on the same day changes nothing.
import { notify } from "@/lib/notify/outbox";
import { raiseAlert } from "@/lib/notify/alerts";
import {
  ddMon,
  monthOf,
  monthlyTotalCents,
  pilotChargeCents,
  pilotDay61,
  pilotFixedCycleDue,
  pilotTermsSet,
  pilotWindowInMonth,
  previousMonth,
  spDate,
  trialAlertDue,
  trialOver,
  trialReminderDue,
  unitWord,
} from "./rules";
import type { PilotRow } from "./store";
import { ALERT_TITLES, auditSubscription, C15_PATH, ensureCustomer, returnToFree, systemAudit, trialEndingMessage, type BillingDeps } from "./service";

export const TRIAL_NOTICE_EVENT = "aviso de fim enviado";

export interface TrialEndResult {
  returnedToFree: string[];
  reminded: string[];
  alerted: string[];
}

/**
 * E02 and 04 §7, §9, §10: a trial past its end without a plan returns to free (Raio-X, sources paused,
 * data kept); 3 days before and on the day the Dono gets trial_ending; 2 days before the team gets an alert.
 * An account whose checkout already created the Asaas subscription has chosen a plan and is left alone.
 */
export async function runTrialEnd(deps: BillingDeps): Promise<TrialEndResult> {
  const { store } = deps;
  const now = deps.now();
  const today = spDate(now);
  const out: TrialEndResult = { returnedToFree: [], reminded: [], alerted: [] };
  for (const sub of await store.subscriptionsByStatus(["trial"])) {
    if (sub.asaasSubscriptionId) continue;
    const account = await store.account(sub.accountId);
    if (!account?.trialEndsAt) continue;
    const ends = account.trialEndsAt;
    if (trialOver(ends, now)) {
      await returnToFree(deps, sub.accountId, "trial_ended", "fim do teste, voltou ao grátis");
      out.returnedToFree.push(sub.accountId);
      continue;
    }
    const due = trialReminderDue(ends, now);
    const sentToday = sub.lastEvent === TRIAL_NOTICE_EVENT && sub.lastEventAt !== null && spDate(sub.lastEventAt) === today;
    if (due && !sentToday) {
      await notify(deps.notify, { code: "trial_ending", accountId: sub.accountId, message: trialEndingMessage(due, ends) });
      await store.updateSubscription(sub.accountId, { lastEvent: TRIAL_NOTICE_EVENT, lastEventAt: now });
      await store.audit([systemAudit(sub.accountId, `notice.trial_ending.${due}`, "subscription", sub.accountId, null, { sent_on: today })]);
      out.reminded.push(sub.accountId);
    }
    if (trialAlertDue(ends, now)) {
      const { created } = await raiseAlert(deps.notify, "baixo", ALERT_TITLES.trialEnding, sub.accountId, C15_PATH);
      if (created) out.alerted.push(sub.accountId);
    }
  }
  return out;
}

export interface UnitsResult {
  /** Accounts whose units_billed changed. */
  changed: string[];
  /** Of those, accounts whose Asaas subscription value was updated for the next cycle. */
  asaasUpdated: string[];
}

/**
 * 04 §7 and 06 §4 "Units": units_billed follows the kitchens in analysis (or channel stores, by
 * plan.billing_unit, D40); when an Asaas subscription exists its value changes from the next cycle on.
 */
export async function runUnitsSync(deps: BillingDeps): Promise<UnitsResult> {
  const { store } = deps;
  const plans = await store.plans();
  const out: UnitsResult = { changed: [], asaasUpdated: [] };
  for (const sub of await store.subscriptionsByStatus(["trial", "active", "past_due"])) {
    const plan = plans.find((p) => p.id === sub.planId);
    if (!plan) continue;
    const units = await store.countUnits(sub.accountId, plan.billingUnit);
    if (units === sub.unitsBilled) continue;
    const value = monthlyTotalCents(plan, units);
    // G-SYN accounts carry made-up Asaas ids (seed): never sent to Asaas.
    const synthetic = (await store.account(sub.accountId))?.isSynthetic ?? false;
    if (sub.asaasSubscriptionId && value !== null && !synthetic) {
      if (units === 0) {
        // Asaas cannot bill zero; a founder decides (keep the value, cancel, or wait for a kitchen).
        await raiseAlert(deps.notify, "medio", ALERT_TITLES.unitsZero, sub.accountId, C15_PATH);
        continue;
      }
      await deps.asaas.updateSubscriptionValue(sub.asaasSubscriptionId, value);
      out.asaasUpdated.push(sub.accountId);
    }
    await store.updateSubscription(sub.accountId, { unitsBilled: units });
    await auditSubscription(deps, sub.accountId, "subscription.units", sub);
    out.changed.push(sub.accountId);
  }
  return out;
}

export interface PilotResult {
  charged: string[];
  noCharge: string[];
  /** Pilots skipped because a value is still open (D37: percentage, cap or start not set). */
  skippedOpenValues: string[];
  failed: string[];
  /** Fixed monthly charges created from day 61 (Marlon 31/out). */
  fixedCharged: string[];
}

/**
 * D37 and 04 §7 pilot. Days 1 to 60, terms set only: for the month that just ended, a separate Asaas charge
 * of pct of what was credited (creditada contestations, C16) inside the pilot's first 60 days, capped at
 * cap_cents. From day 61: the fixed monthly charge (pilotFixedCharge). One row per pilot, month and kind
 * (unique), so a second run never charges twice. A row left `pending` after a failed Asaas call
 * is not resent automatically: a founder checks Asaas first (alert).
 */
export async function runPilotCharges(deps: BillingDeps): Promise<PilotResult> {
  const { store } = deps;
  const now = deps.now();
  const today = spDate(now);
  const month = previousMonth(monthOf(today));
  const out: PilotResult = { charged: [], noCharge: [], skippedOpenValues: [], failed: [], fixedCharged: [] };
  for (const pilot of await store.pilots()) {
    // G-SYN accounts carry made-up Asaas ids (seed): never charged.
    const synthetic = (await store.account(pilot.accountId))?.isSynthetic ?? false;
    if (!pilotTermsSet(pilot)) out.skippedOpenValues.push(pilot.accountId);
    else if (!synthetic) await pilotPercentCharge(deps, pilot, month, today, out);
    if (!synthetic) await pilotFixedCharge(deps, pilot, today, out);
  }
  return out;
}

/** D37 months 1 and 2: pct of the credited amount of `month`, capped. */
async function pilotPercentCharge(deps: BillingDeps, pilot: PilotRow, month: string, today: string, out: PilotResult) {
  const { store } = deps;
  if (pilot.pct === null || pilot.capCents === null || pilot.startedOn === null) return;
  const window = pilotWindowInMonth(pilot.startedOn, month);
  if (!window) return;
  if (await store.pilotCharge(pilot.id, month, "pct")) return;
  const credited = (await store.creditedItems(pilot.accountId, window.from, window.to)).reduce((s, c) => s + c.amountCents, 0);
  const charge = pilotChargeCents(credited, pilot.pct, pilot.capCents);
  const id = await store.insertPilotCharge({
    pilotId: pilot.id,
    month,
    creditedCents: credited,
    kind: "pct",
    chargeCents: charge,
    asaasPaymentId: null,
    status: charge > 0 ? "pending" : "no_charge",
  });
  if (!id) return;
  await store.audit([systemAudit(pilot.accountId, "pilot_charge.compute", "pilot_charge", id, null, { month, credited_cents: credited, charge_cents: charge })]);
  if (charge === 0) {
    out.noCharge.push(pilot.accountId);
    return;
  }
  try {
    const customerId = await ensureCustomer(deps, pilot.accountId, { actorPersonId: null, actorKind: "system", ip: null, userAgent: null });
    const pct = Math.round(pilot.pct * 10000) / 100;
    const { id: paymentId } = await deps.asaas.createPayment({
      customerId,
      valueCents: charge,
      dueDate: today,
      description: `MargoAI piloto, ${month.slice(5, 7)}/${month.slice(0, 4)}: ${String(pct).replace(".", ",")}% do creditado`,
      externalReference: `pilot_charge:${id}`,
    });
    await store.updatePilotCharge(id, { asaasPaymentId: paymentId, status: "charged" });
    await store.audit([systemAudit(pilot.accountId, "pilot_charge.charge", "pilot_charge", id, { status: "pending" }, { status: "charged", asaas_payment_id: paymentId })]);
    out.charged.push(pilot.accountId);
  } catch (err) {
    console.error(JSON.stringify({ service: "billing_jobs", job: "pilot_charges", pilot_charge: id, error: String(err) }));
    await raiseAlert(deps.notify, "medio", ALERT_TITLES.pilotNotSent, pilot.accountId, C15_PATH);
    out.failed.push(pilot.accountId);
  }
}

/**
 * Marlon 31/out: pilots charge from day 61. From day 61 (from the start with terms set, else from the pilot's
 * creation) the daily cron creates one Asaas charge per monthly cycle: units x price, where the price is the
 * pilot's fixed_from_day_61 per unit when the terms are set and given, else the Lucro plan price. Same
 * safeguards as the percentage charge: one row per pilot, month and kind; a failed call stays pending with an
 * alert and is never resent. An account already paying its own Asaas subscription is not charged twice.
 */
async function pilotFixedCharge(deps: BillingDeps, pilot: PilotRow, today: string, out: PilotResult) {
  const { store } = deps;
  const due = pilotFixedCycleDue(pilotDay61(pilot), today);
  if (!due) return;
  const sub = await store.subscription(pilot.accountId);
  if (!sub || sub.asaasSubscriptionId) return;
  const month = monthOf(due);
  if (await store.pilotCharge(pilot.id, month, "fixed")) return;
  const plan = (await store.plans()).find((p) => p.code === "lucro");
  if (!plan) return;
  const unitPrice = pilotTermsSet(pilot) && pilot.fixedFromDay61Cents !== null ? pilot.fixedFromDay61Cents : plan.priceCents;
  if (unitPrice === null) return;
  const units = await store.countUnits(pilot.accountId, plan.billingUnit);
  const charge = monthlyTotalCents({ priceCents: unitPrice }, units) ?? 0;
  const id = await store.insertPilotCharge({
    pilotId: pilot.id,
    kind: "fixed",
    month,
    creditedCents: 0,
    chargeCents: charge,
    asaasPaymentId: null,
    status: charge > 0 ? "pending" : "no_charge",
  });
  if (!id) return;
  await store.audit([systemAudit(pilot.accountId, "pilot_charge.fixed", "pilot_charge", id, null, { month, due_on: due, units, unit_price_cents: unitPrice, charge_cents: charge })]);
  if (charge === 0) {
    out.noCharge.push(pilot.accountId);
    return;
  }
  try {
    const customerId = await ensureCustomer(deps, pilot.accountId, { actorPersonId: null, actorKind: "system", ip: null, userAgent: null });
    const { id: paymentId } = await deps.asaas.createPayment({
      customerId,
      valueCents: charge,
      dueDate: today,
      description: `MargoAI plano Lucro, a partir de ${ddMon(due)}: ${units} ${unitWord(plan.billingUnit, units)}`,
      externalReference: `pilot_charge:${id}`,
    });
    await store.updatePilotCharge(id, { asaasPaymentId: paymentId, status: "charged" });
    await store.audit([systemAudit(pilot.accountId, "pilot_charge.charge", "pilot_charge", id, { status: "pending" }, { status: "charged", asaas_payment_id: paymentId })]);
    out.fixedCharged.push(pilot.accountId);
  } catch (err) {
    console.error(JSON.stringify({ service: "billing_jobs", job: "pilot_fixed_charges", pilot_charge: id, error: String(err) }));
    await raiseAlert(deps.notify, "medio", ALERT_TITLES.pilotNotSent, pilot.accountId, C15_PATH);
    out.failed.push(pilot.accountId);
  }
}

/** The daily run of /api/cron/billing. */
export async function runBillingDaily(deps: BillingDeps) {
  const trial = await runTrialEnd(deps);
  const units = await runUnitsSync(deps);
  const pilots = await runPilotCharges(deps);
  return { trial, units, pilots };
}
