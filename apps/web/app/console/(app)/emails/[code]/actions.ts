"use server";
// Local only: the ten example notices to the Grupo Exemplo owner, delivered to the local Mailpit (E01, E02 and
// the others) and to the C21 WhatsApp queue. Staff only, audited (A04).
import { redirect } from "next/navigation";
import { EXAMPLES, emailSource } from "@/emails";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { notifierFromEnv } from "@/lib/notify/deps";
import { notify, processOutbox } from "@/lib/notify/outbox";
import { SupabaseNotifyStore } from "@/lib/notify/supabase-store";
import type { NoticeCode } from "@/lib/notify/templates";
import { adminClient } from "@/lib/supabase/admin";

export async function sendExamplesAction(): Promise<void> {
  const staff = await requireConsole("clients");
  if (process.env.MARGO_ENV !== "local") redirect("/console/emails/deadline_soon");
  const db = adminClient();
  const { data: account } = await db.from("account").select("id, is_synthetic").eq("code", "G-02").single();
  if (!account?.is_synthetic) redirect("/console/emails/deadline_soon");
  const { data: dono } = await db.from("membership").select("person_id").eq("account_id", account.id).eq("role", "dono").limit(1).single();
  const deps = { store: new SupabaseNotifyStore(db), now: () => new Date() };
  for (const code of Object.keys(EXAMPLES) as NoticeCode[]) {
    await notify(deps, { code, accountId: account.id, personIds: [dono!.person_id], message: emailSource(EXAMPLES[code], { synthetic: true }) });
  }
  const r = await processOutbox({ ...deps, notifier: notifierFromEnv() });
  const meta = await requestMeta();
  await db.from("audit_log").insert({
    actor_person_id: staff.personId,
    actor_kind: "staff",
    account_id: account.id,
    action: "notification.examples",
    entity: "notification",
    after: { sent: r.sent, held: r.held, failed: r.failed },
    ip: meta.ip,
    user_agent: meta.userAgent,
  });
  redirect(`/console/emails/deadline_soon?aviso=${encodeURIComponent(`${r.sent} mensagens no inbox local.`)}`);
}
