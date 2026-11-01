"use server";
// C09 "Gerar fechamento mensal": staff, m2.contestacao, status computed, P06 queued, close_ready, audit_log.
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { isEnabled, requireFlag } from "@/lib/flags";
import { accountByCode } from "@/lib/m2/account";
import { closePeriods, generateClose } from "@/lib/m2/close";
import { parseMonth } from "@/lib/m2/format";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

export async function generateCloseAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, String(form.get("conta") ?? ""));
  await requireFlag("m2.contestacao", account.id);
  const ym = String(form.get("mes") ?? "");
  const close = (await closePeriods(db, account.id)).find((c) => c.month === parseMonth(ym));
  if (!close) notFound();
  // E01 says "sobrou" only with m3.custo on for the account (04 §6, A05).
  const { notified } = await generateClose(db, account, close, staff.personId, new Date(), await requestMeta(), await isEnabled("m3.custo", account.id));
  const path = `/console/contas/${account.code}/fechamento/${ym}/diferencas`;
  revalidatePath(path);
  redirect(`${path}?gerado=${notified ? "avisado" : "sim"}`);
}
