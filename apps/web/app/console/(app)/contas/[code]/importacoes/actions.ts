"use server";
// C07 writes: drop a file (import_run + job), rerun a file. Staff only, flag per channel, audit_log (A04).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isEnabled } from "@/lib/flags";
import { accountByCode, FILE_FLAG } from "@/lib/m2/account";
import type { Channel } from "@/lib/m2/format";
import { ImportRefused, rerunImport, uploadFile } from "@/lib/m2/imports";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

const back = (code: string, msg?: string) => `/console/contas/${encodeURIComponent(code)}/importacoes${msg ? `?aviso=${encodeURIComponent(msg)}` : ""}`;

export async function uploadAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, String(form.get("conta") ?? ""));
  const channel = String(form.get("canal") ?? "") as Channel;
  const flag = FILE_FLAG[channel];
  const file = form.get("arquivo");
  if (!flag || !(await isEnabled(flag, account.id))) redirect(back(account.code, "Importação deste canal desligada para esta conta."));
  if (!(file instanceof File) || file.size === 0) redirect(back(account.code, "Escolha um arquivo."));
  let msg: string | undefined;
  try {
    await uploadFile(db, account, staff.personId, channel, file, await requestMeta());
  } catch (e) {
    if (!(e instanceof ImportRefused)) throw e;
    msg = e.message;
  }
  revalidatePath(back(account.code));
  redirect(back(account.code, msg));
}

export async function rerunAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, String(form.get("conta") ?? ""));
  let msg: string | undefined;
  try {
    await rerunImport(db, account, staff.personId, String(form.get("run") ?? ""), await requestMeta());
  } catch (e) {
    if (!(e instanceof ImportRefused)) throw e;
    msg = e.message;
  }
  revalidatePath(back(account.code));
  redirect(back(account.code, msg));
}
