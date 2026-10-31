"use server";
// C21 "resolver": staff only (requireConsole and again in resolveAlert); writes resolved_by and audit_log.
// C21 WhatsApp queue "marcar enviada" (06 §7): staff only, audited.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markWhatsAppSent } from "@/lib/notify/manual-queue";
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

/** 06 §7: a founder sent a manual WhatsApp by hand. Staff only; held in quiet hours (E05); audited (A04). */
export async function markWhatsAppSentAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const r = await markWhatsAppSent(adminClient(), String(form.get("notification") ?? ""), staff.personId, await requestMeta(), new Date());
  revalidatePath("/console/alertas");
  if (!r.ok) redirect(`/console/alertas?aviso=${encodeURIComponent(r.message)}`);
}
