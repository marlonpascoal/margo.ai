"use server";
// C19 "vincular": staff link a store "sem cozinha" to a kitchen of the account (D29); audit_log (A04).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountByCode } from "@/lib/m2/account";
import { linkStore } from "@/lib/m2/structure";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

export async function linkStoreAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, String(form.get("conta") ?? ""));
  const brand = String(form.get("marca") ?? "");
  await linkStore(db, account, staff.personId, String(form.get("loja") ?? ""), String(form.get("cozinha") ?? ""), brand || null, await requestMeta());
  const path = `/console/contas/${account.code}/estrutura`;
  revalidatePath(path);
  redirect(path);
}
