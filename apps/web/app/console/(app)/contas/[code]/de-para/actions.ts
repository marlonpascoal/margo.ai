"use server";
// C11 writes: confirm a suggestion, swap to another catalog ingredient (or a new one), refuse a suggestion.
// Staff only, flag m3.depara_ia, audit_log (A04). Prices come only from public.confirm_ingredient_match (D14).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode } from "@/lib/m2/account";
import { confirmGroup, DeparaRefused, rejectGroup, swapGroup } from "@/lib/m3/depara";
import type { BaseUnit } from "@/lib/m3/format";
import { adminClient } from "@/lib/supabase/admin";

const back = (code: string, msg?: string) => `/console/contas/${encodeURIComponent(code)}/de-para${msg ? `?aviso=${encodeURIComponent(msg)}` : ""}`;
const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

async function run(form: FormData, write: (ctx: { db: ReturnType<typeof adminClient>; account: Awaited<ReturnType<typeof accountByCode>>; staffId: string; key: string; meta: Awaited<ReturnType<typeof requestMeta>> }) => Promise<unknown>) {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, text(form, "conta"));
  await requireFlag("m3.depara_ia", account.id);
  let msg: string | undefined;
  try {
    await write({ db, account, staffId: staff.personId, key: text(form, "grupo"), meta: await requestMeta() });
  } catch (e) {
    if (!(e instanceof DeparaRefused)) throw e;
    msg = e.message;
  }
  revalidatePath(back(account.code));
  redirect(back(account.code, msg));
}

export async function confirmAction(form: FormData): Promise<void> {
  await run(form, (c) => confirmGroup(c.db, c.account, c.staffId, c.key, text(form, "conversao") || null, c.meta));
}

export async function rejectAction(form: FormData): Promise<void> {
  await run(form, (c) => rejectGroup(c.db, c.account, c.staffId, c.key, c.meta));
}

export async function swapAction(form: FormData): Promise<void> {
  await run(form, (c) => {
    const existing = text(form, "insumo");
    const choice = existing
      ? { ingredientId: existing }
      : { name: text(form, "novo_nome"), category: text(form, "novo_categoria"), baseUnit: (["g", "ml", "un"].includes(text(form, "novo_unidade")) ? text(form, "novo_unidade") : "g") as BaseUnit };
    return swapGroup(c.db, c.account, c.staffId, c.key, choice, text(form, "conversao") || null, c.meta);
  });
}
