"use server";
// C15 server actions. requireConsole("billing") answers 404 to anyone but Fundador; lib/billing/admin.ts
// checks the role again and writes audit_log with before and after.
import { revalidatePath } from "next/cache";
import { savePilot, updatePlan } from "@/lib/billing/admin";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

const PATH = "/console/assinaturas";
const text = (form: FormData, name: string) => String(form.get(name) ?? "");

export type FormState = { message: string | null; saved: boolean };

async function actor() {
  const staff = await requireConsole("billing");
  return { personId: staff.personId, ...(await requestMeta()) };
}

export async function savePlanAction(_prev: FormState, form: FormData): Promise<FormState> {
  const who = await actor();
  const r = await updatePlan(adminClient(), who, {
    planId: text(form, "plan"),
    price: text(form, "price"),
    billingUnit: text(form, "unit"),
    trialDays: text(form, "trial"),
    competitorXrays: text(form, "competitor"),
    priceIsExample: form.get("example") === "on",
  });
  if (!r.ok) return { message: r.message, saved: false };
  revalidatePath(PATH);
  return { message: null, saved: true };
}

export async function savePilotAction(_prev: FormState, form: FormData): Promise<FormState> {
  const who = await actor();
  const r = await savePilot(adminClient(), who, {
    pilotId: text(form, "pilot"),
    accountId: text(form, "account"),
    pct: text(form, "pct"),
    cap: text(form, "cap"),
    fixed: text(form, "fixed"),
    startedOn: text(form, "started"),
  });
  if (!r.ok) return { message: r.message, saved: false };
  revalidatePath(PATH);
  return { message: null, saved: true };
}
