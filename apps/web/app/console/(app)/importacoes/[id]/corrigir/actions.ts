"use server";
// C17 "Salvar e reprocessar": staff, the run's channel flag, column_mapping for the file signature, the run
// requeued, audit_log (A04). Refused unless the payout check bates and every new column has a decision.
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { FILE_FLAG } from "@/lib/m2/account";
import { ImportRefused } from "@/lib/m2/imports";
import { loadCorrection, saveMapping } from "@/lib/m2/mapping";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

export async function saveMappingAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const run = await loadCorrection(db, String(form.get("run") ?? ""));
  if (!run) notFound();
  const flag = FILE_FLAG[run.channel];
  if (!flag) notFound();
  await requireFlag(flag, run.accountId);
  const { data: acc } = await db.from("account").select("id, code, name, is_synthetic").eq("id", run.accountId).single();
  const account = { id: acc!.id, code: acc!.code, name: acc!.name, isSynthetic: acc!.is_synthetic };
  try {
    await saveMapping(db, account, run, staff.personId, form, await requestMeta());
  } catch (e) {
    if (!(e instanceof ImportRefused)) throw e;
    redirect(`/console/importacoes/${run.id}/corrigir?aviso=${encodeURIComponent(e.message)}`);
  }
  revalidatePath(`/console/contas/${account.code}/importacoes`);
  redirect(`/console/contas/${account.code}/importacoes`);
}
