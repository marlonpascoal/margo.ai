"use server";
// W09 "Sair" on one device: only the person's own sessions (checked here), audited (A04).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestMeta } from "@/lib/console/request";
import { auditMember, requireMember } from "@/lib/portal/session";
import { adminClient } from "@/lib/supabase/admin";
import { sessionClient } from "@/lib/supabase/server";

export async function signOutDevice(form: FormData): Promise<void> {
  const m = await requireMember();
  const ids = String(form.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0) return;
  const db = adminClient();
  const { data: rows } = await db
    .from("session_device")
    .update({ revoked_at: new Date().toISOString() })
    .eq("person_id", m.personId)
    .in("id", ids)
    .is("revoked_at", null)
    .select("id");
  const revoked = (rows ?? []).map((r) => r.id);
  if (revoked.length === 0) return;
  await auditMember(db, m, { action: "session.revoke", entity: "session_device", entityId: revoked[0], after: { revoked }, meta: await requestMeta() });
  if (revoked.includes(m.sessionDeviceId)) {
    await (await sessionClient()).auth.signOut({ scope: "local" });
    redirect("/entrar");
  }
  revalidatePath("/app/seguranca");
}
