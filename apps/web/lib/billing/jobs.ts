// Billing jobs (04 §7, 04 §9, 06 §4, D37). Quick database updates plus a few Asaas calls, so they run in the
// web app from Vercel Cron (02 §4.3) through /api/cron/billing, once a day. Every job is idempotent: a
// second run on the same day changes nothing.
import { notify } from "@/lib/notify/outbox";
import { raiseAlert } from "@/lib/notify/alerts";
import {
  monthOf,
  monthlyTotalCents,
  pilotChargeCents,
  pilotWindowInMonth,
  previousMonth,
  spDate,
  trialAlertDue,
  trialOver,
  trialReminderDue,
} from "./rules";
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
}

/**
 * D37 and 04 §7 pilot: for the month that just ended, a separate Asaas charge of pct of what was credited
 * (creditada contestations, C16) inside the pilot's first 60 days, capped at cap_cents. One row per pilot
 * and month (unique), so a second run never charges twice. A row left `pending` after a failed Asaas call
 * is not resent automatically: a founder checks Asaas first (alert).
 */
export async function runPilotCharges(deps: BillingDeps): Promise<PilotResult> {
  const { store } = deps;
  const now = deps.now();
  const today = spDate(now);
  const month = previousMonth(monthOf(today));
  const out: PilotResult = { charged: [], noCharge: [], skippedOpenValues: [], failed: [] };
  for (const pilot of await store.pilots()) {
    if (pilot.pct === null || pilot.capCents === null || pilot.startedOn === null) {
      out.skippedOpenValues.push(pilot.accountId);
      continue;
    }
    // G-SYN accounts carry made-up Asaas ids (seed): never charged.
    if ((await store.account(pilot.accountId))?.isSynthetic) continue;
    const window = pilotWindowInMonth(pilot.startedOn, month);
    if (!window) continue;
    if (await store.pilotCharge(pilot.id, month)) continue;
    const credited = (await store.creditedItems(pilot.accountId, window.from, window.to)).reduce((s, c) => s + c.amountCents, 0);
    const charge = pilotChargeCents(credited, pilot.pct, pilot.capCents);
    const id = await store.insertPilotCharge({
      pilotId: pilot.id,
      month,
      creditedCents: credited,
      chargeCents: charge,
      asaasPaymentId: null,
      status: charge > 0 ? "pending" : "no_charge",
    });
    if (!id) continue;
    await store.audit([systemAudit(pilot.accountId, "pilot_charge.compute", "pilot_charge", id, null, { month, credited_cents: credited, charge_cents: charge })]);
    if (charge === 0) {
      out.noCharge.push(pilot.accountId);
      continue;
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
  return out;
}

/** The daily run of /api/cron/billing. */
export async function runBillingDaily(deps: BillingDeps) {
  const trial = await runTrialEnd(deps);
  const units = await runUnitsSync(deps);
  const pilots = await runPilotCharges(deps);
  return { trial, units, pilots };
}
