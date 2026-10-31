// C15 edits (04 §5 billing area: Fundador only; D37, D40): plan values and pilots. The server actions call
// requireConsole("billing") first; this module checks the staff role again and writes audit_log with
// before and after for every change.
import type { Db } from "@/lib/supabase/admin";
import type { RequestMeta } from "@/lib/notify/store";
import { SupabaseNotifyStore } from "@/lib/notify/supabase-store";
import { canConsole } from "@/lib/permissions";
import type { BillingUnit } from "./rules";
import { PLAN_COLUMNS, toPlan } from "./supabase-store";

export interface StaffActor extends RequestMeta {
  personId: string;
}

export type AdminResult = { ok: true } | { ok: false; message: string };

/** Not drawn; short, in the C15 style. */
export const ADMIN_MESSAGES = {
  forbidden: "Só o papel Fundador muda planos e pilotos.",
  price: "Preço inválido. Use reais, por exemplo 300 ou 300,00.",
  trialDays: "Dias de teste: um número de 0 a 90.",
  pct: "Percentual inválido. Use, por exemplo, 20%.",
  cap: "Teto inválido. Use reais, por exemplo 500.",
  fixed: "Valor a partir do mês 3 inválido. Use reais, por exemplo 300.",
  startedOn: "Data de início inválida.",
  account: "Escolha a conta.",
  pilotExists: "Esta conta já tem piloto.",
  notFound: "Não encontrado.",
} as const;

/** "R$ 1.234,50", "300", "300,00" -> centavos; "" -> null; anything else -> undefined (invalid). */
export function parseMoney(text: string): number | null | undefined {
  const t = text.replace(/R\$/i, "").replace(/\s+/g, "").replace(/(por|\/).*$/i, "");
  if (t === "") return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return undefined;
  const [int, dec = ""] = t.replace(/\./g, "").split(",");
  return Number(int) * 100 + Number(dec.padEnd(2, "0"));
}

/** "20%", "20", "12,5%" -> 0.2, 0.125; "" -> null; invalid or above 100% -> undefined. */
export function parsePct(text: string): number | null | undefined {
  const t = text.replace(/\s+/g, "").replace(/%$/, "");
  if (t === "") return null;
  if (!/^\d{1,3}(,\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t.replace(",", "."));
  return n > 100 ? undefined : Math.round(n * 100) / 10000;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

async function isFundador(db: Db, personId: string): Promise<boolean> {
  const { data } = await db.from("staff").select("role").eq("person_id", personId).maybeSingle();
  return canConsole(data?.role, "billing");
}

const audit = (db: Db, actor: StaffActor, accountId: string | null, action: string, entity: string, entityId: string, before: unknown, after: unknown) =>
  new SupabaseNotifyStore(db).audit([{ actorPersonId: actor.personId, actorKind: "staff", accountId, action, entity, entityId, before, after, ip: actor.ip, userAgent: actor.userAgent }]);

export interface PlanEdit {
  planId: string;
  price: string;
  billingUnit: string;
  trialDays: string;
  priceIsExample: boolean;
}

/** C15 plan editor (D40): price, trial days, billing unit and the "preços de exemplo" mark are data. */
export async function updatePlan(db: Db, actor: StaffActor, edit: PlanEdit): Promise<AdminResult> {
  if (!(await isFundador(db, actor.personId))) return { ok: false, message: ADMIN_MESSAGES.forbidden };
  const price = parseMoney(edit.price);
  if (price === undefined) return { ok: false, message: ADMIN_MESSAGES.price };
  const trialDays = Number(edit.trialDays);
  if (!/^\d{1,2}$/.test(edit.trialDays.trim()) || trialDays > 90) return { ok: false, message: ADMIN_MESSAGES.trialDays };
  const unit: BillingUnit = edit.billingUnit === "channel_store" ? "channel_store" : "kitchen";
  const { data: row, error } = await db.from("plan").select(PLAN_COLUMNS).eq("id", edit.planId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { ok: false, message: ADMIN_MESSAGES.notFound };
  const before = toPlan(row);
  const after = { price_cents: price, billing_unit: unit, trial_days: trialDays, price_is_example: edit.priceIsExample };
  const same =
    before.priceCents === price && before.billingUnit === unit && before.trialDays === trialDays && before.priceIsExample === edit.priceIsExample;
  if (same) return { ok: true };
  const upd = await db.from("plan").update(after).eq("id", edit.planId);
  if (upd.error) throw new Error(upd.error.message);
  await audit(
    db,
    actor,
    null,
    "plan.update",
    "plan",
    edit.planId,
    { price_cents: before.priceCents, billing_unit: before.billingUnit, trial_days: before.trialDays, price_is_example: before.priceIsExample },
    after,
  );
  return { ok: true };
}

export interface PilotEdit {
  /** Empty for "Novo piloto". */
  pilotId: string;
  accountId: string;
  pct: string;
  cap: string;
  fixed: string;
  startedOn: string;
}

/** C15 "Novo piloto" and pilot edits (D37: percentage and cap per account; values may stay open). */
export async function savePilot(db: Db, actor: StaffActor, edit: PilotEdit): Promise<AdminResult> {
  if (!(await isFundador(db, actor.personId))) return { ok: false, message: ADMIN_MESSAGES.forbidden };
  const pct = parsePct(edit.pct);
  if (pct === undefined) return { ok: false, message: ADMIN_MESSAGES.pct };
  const cap = parseMoney(edit.cap);
  if (cap === undefined) return { ok: false, message: ADMIN_MESSAGES.cap };
  const fixed = parseMoney(edit.fixed);
  if (fixed === undefined) return { ok: false, message: ADMIN_MESSAGES.fixed };
  const startedOn = edit.startedOn.trim() || null;
  if (startedOn && !isDate(startedOn)) return { ok: false, message: ADMIN_MESSAGES.startedOn };
  const values = { pct_months_1_2: pct, cap_cents: cap, fixed_from_day_61_cents: fixed, started_on: startedOn };

  if (!edit.pilotId) {
    if (!edit.accountId) return { ok: false, message: ADMIN_MESSAGES.account };
    const { data: acc } = await db.from("account").select("id").eq("id", edit.accountId).maybeSingle();
    if (!acc) return { ok: false, message: ADMIN_MESSAGES.account };
    const ins = await db.from("pilot").insert({ account_id: edit.accountId, ...values }).select("id").single();
    if (ins.error) {
      if (ins.error.code === "23505") return { ok: false, message: ADMIN_MESSAGES.pilotExists };
      throw new Error(ins.error.message);
    }
    await audit(db, actor, edit.accountId, "pilot.create", "pilot", ins.data.id, null, values);
    return { ok: true };
  }

  const { data: before, error } = await db.from("pilot").select("account_id, pct_months_1_2, cap_cents, fixed_from_day_61_cents, started_on").eq("id", edit.pilotId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!before) return { ok: false, message: ADMIN_MESSAGES.notFound };
  const prev = {
    pct_months_1_2: before.pct_months_1_2 === null ? null : Number(before.pct_months_1_2),
    cap_cents: before.cap_cents,
    fixed_from_day_61_cents: before.fixed_from_day_61_cents,
    started_on: before.started_on,
  };
  if (JSON.stringify(prev) === JSON.stringify(values)) return { ok: true };
  const upd = await db.from("pilot").update(values).eq("id", edit.pilotId);
  if (upd.error) throw new Error(upd.error.message);
  await audit(db, actor, before.account_id, "pilot.update", "pilot", edit.pilotId, prev, values);
  return { ok: true };
}
