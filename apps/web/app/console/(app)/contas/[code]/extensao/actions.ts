"use server";
// Console side of P04 pairing (06 §9): a founder makes a short code for a person of the account (to read to
// them on a call) and revokes a paired extension. Staff only, flag m2.extensao_chrome (A05), audited (A04).
import { revalidatePath } from "next/cache";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { createPairingCode, revokeExtensionToken } from "@/lib/extension/server";
import { requireFlag } from "@/lib/flags";
import { accountByCode } from "@/lib/m2/account";
import { adminClient } from "@/lib/supabase/admin";

export type CodeState = { code: string; expiresAt: string; person: string } | { error: string } | null;

export async function pairingCodeAction(_prev: CodeState, form: FormData): Promise<CodeState> {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, String(form.get("conta") ?? ""));
  await requireFlag("m2.extensao_chrome", account.id);
  const personId = String(form.get("pessoa") ?? "");
  const r = await createPairingCode(db, { personId, accountId: account.id, actor: { personId: staff.personId, kind: "staff" } }, await requestMeta(), new Date());
  revalidatePath(`/console/contas/${account.code}/extensao`);
  if (!r) return { error: "Escolha uma pessoa desta conta." };
  const { data: p } = await db.from("person").select("name").eq("id", personId).single();
  return { code: r.code, expiresAt: r.expiresAt.toISOString(), person: p?.name ?? "" };
}

export async function revokeAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, String(form.get("conta") ?? ""));
  await requireFlag("m2.extensao_chrome", account.id);
  await revokeExtensionToken(db, String(form.get("token") ?? ""), account.id, { personId: staff.personId, kind: "staff" }, await requestMeta(), new Date());
  revalidatePath(`/console/contas/${account.code}/extensao`);
}
