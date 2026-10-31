// Billing rules of 04 §7 (D27, D28, D37, D40) as pure functions. Callers pass the clock; dates are
// business dates in America/Sao_Paulo (yyyy-mm-dd strings), money is integer centavos.
import type { Database } from "@margoai/contracts";
import { TIME_ZONE } from "@/lib/format";

export type BillingUnit = Database["public"]["Enums"]["billing_unit"];
export type SubscriptionStatus = Database["public"]["Enums"]["subscription_status"];
export type PlanCode = "raio_x" | "lucro" | "rede";

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  /** null: by conversation (Rede). */
  priceCents: number | null;
  billingUnit: BillingUnit;
  trialDays: number;
  priceIsExample: boolean;
}

/** yyyy-mm-dd of an instant in São Paulo. */
export function spDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const dayNumber = (isoDay: string) => Date.UTC(Number(isoDay.slice(0, 4)), Number(isoDay.slice(5, 7)) - 1, Number(isoDay.slice(8, 10))) / 86_400_000;

/** Whole days from `from` to `to` (both yyyy-mm-dd). */
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

export function addDays(isoDay: string, days: number): string {
  return new Date((dayNumber(isoDay) + days) * 86_400_000).toISOString().slice(0, 10);
}

/** Same day next month, clamped to the month's last day (Asaas monthly cycle). */
export function addMonth(isoDay: string): string {
  const y = Number(isoDay.slice(0, 4));
  const m = Number(isoDay.slice(5, 7));
  const d = Number(isoDay.slice(8, 10));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** First day of the month of a yyyy-mm-dd. */
export const monthOf = (isoDay: string) => `${isoDay.slice(0, 7)}-01`;

/** First day of the month before. */
export function previousMonth(isoMonth: string): string {
  const y = Number(isoMonth.slice(0, 4));
  const m = Number(isoMonth.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/** 04 §7 trial: days left until the trial end, in São Paulo days (0 on the last day, negative after). */
export function trialDaysLeft(trialEndsAt: Date, now: Date): number {
  return daysBetween(spDate(now), spDate(trialEndsAt));
}

/** 04 §7: the trial is over once its end instant has passed. */
export const trialOver = (trialEndsAt: Date, now: Date) => now.getTime() >= trialEndsAt.getTime();

/**
 * 04 §9 trial_ending: "3 days before and on the day". Which reminder is due today, if any.
 */
export function trialReminderDue(trialEndsAt: Date, now: Date): "d3" | "d0" | null {
  const left = trialDaysLeft(trialEndsAt, now);
  if (trialOver(trialEndsAt, now)) return null;
  return left === 3 ? "d3" : left === 0 ? "d0" : null;
}

/** 04 §10 baixo: "trial ends in 2 days without a plan". */
export const trialAlertDue = (trialEndsAt: Date, now: Date) => trialDaysLeft(trialEndsAt, now) === 2 && !trialOver(trialEndsAt, now);

/** 04 §7, P09/W05 "Done when": the monthly total is the plan price times the billing units. */
export function monthlyTotalCents(plan: Pick<PlanRow, "priceCents">, units: number): number | null {
  return plan.priceCents === null ? null : plan.priceCents * units;
}

/**
 * 06 §4 Trial: when converting during the trial the first nextDueDate is the trial end date; otherwise the
 * first charge is today.
 */
export function firstDueDate(trialEndsAt: Date | null, status: SubscriptionStatus, now: Date): string {
  const today = spDate(now);
  if (status === "trial" && trialEndsAt && !trialOver(trialEndsAt, now)) {
    const end = spDate(trialEndsAt);
    return end > today ? end : today;
  }
  return today;
}

// D37 pilot ------------------------------------------------------------------------------------------

/** D37: months 1 and 2 are the first 60 days from the pilot start; from day 61 the fixed price applies. */
export const PILOT_PERCENT_DAYS = 60;

/** The pilot days that fall in a calendar month, as [from, to) yyyy-mm-dd, or null when none do. */
export function pilotWindowInMonth(startedOn: string, month: string): { from: string; to: string } | null {
  const end = addDays(startedOn, PILOT_PERCENT_DAYS);
  const monthEnd = addMonth(month);
  const from = startedOn > month ? startedOn : month;
  const to = end < monthEnd ? end : monthEnd;
  return from < to ? { from, to } : null;
}

/** D37: pct of the credited amount, half up, capped. A null cap means no cap (preview only, see jobs). */
export function pilotChargeCents(creditedCents: number, pct: number, capCents: number | null): number {
  const raw = Math.round(creditedCents * pct);
  return capCents === null ? raw : Math.min(raw, capCents);
}

// Display --------------------------------------------------------------------------------------------

/** "cozinha"/"cozinhas" or "loja"/"lojas", by the plan's billing unit (D40: data, not code). */
export function unitWord(unit: BillingUnit, n: number): string {
  if (unit === "kitchen") return n === 1 ? "cozinha" : "cozinhas";
  return n === 1 ? "loja" : "lojas";
}

const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "08/nov", as drawn in W05 and C15 (two-digit day). Takes an instant or a yyyy-mm-dd. */
export function ddMon(d: Date | string): string {
  const iso = typeof d === "string" ? d : spDate(d);
  return `${iso.slice(8, 10)}/${MON[Number(iso.slice(5, 7)) - 1]}`;
}
