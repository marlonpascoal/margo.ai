"use server";
// P16, W08 toggles (E05). The person changes only their own preferences for the open account;
// updateNoticePref refuses e-mail off for a locked notice and writes audit_log, and the database
// trigger app.notice_pref_locked refuses it again.
import { revalidatePath } from "next/cache";
import { requestMeta } from "@/lib/console/request";
import { updateNoticePref } from "@/lib/notify/prefs";
import { SupabaseNotifyStore } from "@/lib/notify/supabase-store";
import { requireMember } from "@/lib/portal/session";
import { adminClient } from "@/lib/supabase/admin";

export async function setNoticePref(code: string, channel: "email" | "whatsapp", value: boolean): Promise<{ ok: boolean; message?: string }> {
  const m = await requireMember();
  if (channel !== "email" && channel !== "whatsapp") return { ok: false };
  const r = await updateNoticePref(
    { store: new SupabaseNotifyStore(adminClient()), now: () => new Date() },
    { personId: m.personId, accountId: m.account.id, noticeCode: String(code), [channel]: value === true, meta: await requestMeta() },
  );
  revalidatePath("/app/notificacoes");
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
