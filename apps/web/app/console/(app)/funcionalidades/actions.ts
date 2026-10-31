"use server";
// C20 server actions. requireConsole("flags") answers 404 to anyone but Fundador; lib/flags/admin.ts checks
// the role again, and the SQL functions write feature_flag_log and audit_log in the same transaction.
import { revalidatePath } from "next/cache";
import { addException, removeException, setPlanDefault, type Actor, type AdminResult } from "@/lib/flags/admin";
import { SupabaseFlagAdminStore } from "@/lib/flags/supabase-admin-store";
import type { FlagEnv, FlagKey, PlanCode } from "@/lib/flags/keys";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

const PATH = "/console/funcionalidades";

async function context(): Promise<{ store: SupabaseFlagAdminStore; actor: Actor }> {
  const staff = await requireConsole("flags");
  return { store: new SupabaseFlagAdminStore(adminClient()), actor: { personId: staff.personId, ...(await requestMeta()) } };
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Toggles one plan default: the form carries the new value. */
export async function toggleDefaultAction(form: FormData): Promise<void> {
  const { store, actor } = await context();
  await setPlanDefault(store, actor, {
    key: text(form, "key") as FlagKey,
    env: text(form, "env") as FlagEnv,
    plan: text(form, "plan") as PlanCode,
    value: text(form, "value") === "true",
  });
  revalidatePath(PATH);
}

export async function removeExceptionAction(form: FormData): Promise<void> {
  const { store, actor } = await context();
  await removeException(store, actor, { key: text(form, "key") as FlagKey, env: text(form, "env") as FlagEnv, accountId: text(form, "account") });
  revalidatePath(PATH);
}

export type ExceptionFormState = { message: string | null };

export async function addExceptionAction(_prev: ExceptionFormState, form: FormData): Promise<ExceptionFormState> {
  const { store, actor } = await context();
  const result: AdminResult = await addException(store, actor, {
    key: text(form, "key") as FlagKey,
    env: text(form, "env") as FlagEnv,
    accountId: text(form, "account"),
    value: text(form, "value") === "true",
    reason: text(form, "reason"),
  });
  if (!result.ok) return { message: result.message };
  revalidatePath(PATH);
  return { message: null };
}
