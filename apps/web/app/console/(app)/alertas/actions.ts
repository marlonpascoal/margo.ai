"use server";
// C21 "resolver": staff only (requireConsole and again in resolveAlert); writes resolved_by and audit_log.
import { revalidatePath } from "next/cache";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { resolveAlert } from "@/lib/notify/alerts";
import { SupabaseNotifyStore } from "@/lib/notify/supabase-store";
import { adminClient } from "@/lib/supabase/admin";

export async function resolveAlertAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  // Store and clock only: lib/notify/deps.ts also wires the dev inbox, which pages do not need.
  const deps = { store: new SupabaseNotifyStore(adminClient()), now: () => new Date() };
  await resolveAlert(deps, String(form.get("alert") ?? ""), staff.personId, await requestMeta());
  revalidatePath("/console/alertas");
}
