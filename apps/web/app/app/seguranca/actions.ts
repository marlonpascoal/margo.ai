"use server";
// W09 "Sair" on one device: only the person's own sessions (checked here), audited (A04).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SupabaseLoginStore } from "@/lib/auth/supabase-store";
import { requestMeta } from "@/lib/console/request";
import { enqueueDeps } from "@/lib/jobs/deps";
import { notifyDeps } from "@/lib/notify/deps";
import { requestDeletion, requestExport } from "@/lib/portal/account-data";
import { checkConfirmCode, EphemeralAuthGateway, sendConfirmCode, type ConfirmDeps } from "@/lib/portal/confirm-code";
import { changeLoginEmail, checkNewEmail, CONTACT_MESSAGES, startEmailChange } from "@/lib/portal/contact-change";
import { W09_MESSAGES } from "@/lib/portal/security";
import { auditMember, requireMember, requirePortal } from "@/lib/portal/session";
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

// W09 contact change and data section (04 §5, §8, E04, E06), checked here on every call: every profile
// changes its own login e-mail (Marlon, 31/out); export and deletion are Dono only. The writes are audited
// in lib/portal/contact-change.ts and lib/portal/account-data.ts.

export type W09State = { message: string | null; error?: boolean; email?: string };

function confirmDeps(): ConfirmDeps {
  return { guards: new SupabaseLoginStore(adminClient()), gateway: new EphemeralAuthGateway(), now: () => new Date() };
}

/** "Trocar" e-mail, step 1: the code goes to the new address. Any profile, for its own login only. */
export async function sendEmailCode(_prev: W09State, form: FormData): Promise<W09State> {
  const m = await requireMember();
  const db = adminClient();
  const check = await checkNewEmail(db, m.personId, m.email, String(form.get("email") ?? ""));
  if (!check.ok) return { message: check.message, error: true };
  await startEmailChange(db, { personId: m.personId, accountId: m.account.id, newEmail: check.email, now: new Date() });
  const sent = await sendConfirmCode(confirmDeps(), check.email);
  return { message: sent.message, error: !sent.ok, email: sent.ok ? check.email : undefined };
}

/** "Trocar" e-mail, step 2: the code proves the new address; then E04 (lock, audit, notice to the old one). */
export async function confirmEmailChange(_prev: W09State, form: FormData): Promise<W09State> {
  const m = await requireMember();
  const db = adminClient();
  const email = String(form.get("email") ?? "");
  const check = await checkNewEmail(db, m.personId, m.email, email);
  if (!check.ok) return { message: check.message, error: true };
  const proved = await checkConfirmCode(confirmDeps(), check.email, String(form.get("code") ?? ""));
  if (!proved.ok) return { message: proved.message, error: true, email: check.email };
  const done = await changeLoginEmail(db, {
    personId: m.personId,
    personName: m.name,
    accountId: m.account.id,
    oldEmail: m.email,
    newEmail: check.email,
    provedBy: proved.authUserId,
    meta: await requestMeta(),
  });
  if (!done.ok) return { message: done.message, error: true };
  revalidatePath("/app/seguranca");
  return { message: CONTACT_MESSAGES.done };
}

/** "Baixar todos os meus dados": queues the export zip (E06); the page links it when ready. */
export async function requestDataExport(_prev: W09State, _form: FormData): Promise<W09State> {
  const m = await requirePortal({ roles: ["dono"] });
  await requestExport(adminClient(), enqueueDeps(), { personId: m.personId, personName: m.name, accountId: m.account.id, accountName: m.account.name, meta: await requestMeta() });
  revalidatePath("/app/seguranca");
  return { message: W09_MESSAGES.exportQueued };
}

/** "Excluir a conta e os dados", step 1: the code goes to the Dono's own login e-mail. */
export async function sendDeletionCode(_prev: W09State, _form: FormData): Promise<W09State> {
  const m = await requirePortal({ action: "delete_account" });
  if (!m.email) return { message: W09_MESSAGES.noEmail, error: true };
  const sent = await sendConfirmCode(confirmDeps(), m.email);
  return { message: sent.message, error: !sent.ok, email: sent.ok ? m.email : undefined };
}

/** Step 2: the right code queues account_delete and confirms by e-mail to every Dono (E06). */
export async function confirmDeletion(_prev: W09State, form: FormData): Promise<W09State> {
  const m = await requirePortal({ action: "delete_account" });
  if (!m.email) return { message: W09_MESSAGES.noEmail, error: true };
  const db = adminClient();
  const proved = await checkConfirmCode(confirmDeps(), m.email, String(form.get("code") ?? ""));
  if (!proved.ok) return { message: proved.message, error: true, email: m.email };
  const { data: person } = await db.from("person").select("auth_user_id").eq("id", m.personId).single();
  if (person?.auth_user_id !== proved.authUserId) return { message: W09_MESSAGES.noEmail, error: true };
  await requestDeletion(db, { enqueue: enqueueDeps(), notify: notifyDeps() }, { personId: m.personId, personName: m.name, accountId: m.account.id, accountName: m.account.name, meta: await requestMeta() });
  return { message: W09_MESSAGES.deletionQueued };
}
