"use server";
// C16: staff mark "Foi negada" when the owner says so (04 §3); never creditada. The status moves through
// public.contestation_mark, which checks the transition and writes audit_log with ip and user agent.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { accountByCode } from "@/lib/m2/account";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

export async function markDeniedAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, String(form.get("conta") ?? ""));
  await requireFlag("m2.contestacao", account.id);
  const id = String(form.get("contestacao") ?? "");
  const { data: c } = await db.from("contestation").select("id").eq("id", id).eq("account_id", account.id).maybeSingle();
  const path = `/console/contas/${account.code}/contestacoes`;
  if (!c) redirect(path);
  const meta = await requestMeta();
  const { error } = await db.rpc("contestation_mark", {
    p_contestation: c.id,
    p_event: "foi_negada",
    p_actor_kind: "staff",
    p_actor: staff.personId,
    p_ip: meta.ip ?? undefined,
    p_user_agent: meta.userAgent ?? undefined,
  });
  revalidatePath(path);
  redirect(error ? `${path}?aviso=${encodeURIComponent("Só uma contestação em análise pode ser marcada como negada.")}` : path);
}
