"use server";
// C12 writes: a recipe line (quantity, yield) and the packaging of a dish per channel. Staff only, audited (A04);
// worker-cost recomputes costs and contribution (compute_contribution). Flag m3.custo (04 §6).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { accountByCode } from "@/lib/m2/account";
import { CHANNEL_ORDER, type Channel } from "@/lib/m2/format";
import {
  editRecipeLine,
  parseLineEdit,
  parseReais,
  setPackaging,
} from "@/lib/m3/edit";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

const s = (form: FormData, k: string) => String(form.get(k) ?? "");

export async function saveLinesAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, s(form, "conta"));
  await requireFlag("m3.custo", account.id);
  const dish = s(form, "prato");
  const back = `/console/contas/${account.code}/fichas?prato=${encodeURIComponent(dish)}`;
  const who = {
    staffId: staff.personId,
    accountId: account.id,
    meta: await requestMeta(),
  };
  const ids = form.getAll("linha").map(String);
  const edits = ids.map((id) => ({
    id,
    edit: parseLineEdit(
      s(form, `qtd:${id}`),
      s(form, `rend:${id}`),
      s(form, `conf:${id}`),
    ),
  }));
  if (edits.some((e) => e.edit === null))
    redirect(`${back}&editar=1&aviso=valor`);
  const { data: current } = await db
    .from("recipe_line")
    .select("id, qty_base_units, yield_pct, yield_confidence")
    .in("id", ids)
    .eq("account_id", account.id);
  const now = new Map((current ?? []).map((l) => [l.id, l]));
  for (const { id, edit } of edits) {
    const was = now.get(id);
    if (!was || !edit) continue;
    if (
      Number(was.qty_base_units) === edit.qty &&
      Number(was.yield_pct) === edit.yieldPct &&
      was.yield_confidence === edit.confidence
    )
      continue;
    await editRecipeLine(db, who, id, edit);
  }
  for (const ch of CHANNEL_ORDER) {
    const v = form.get(`emb:${ch}`);
    if (v === null) continue;
    const cents = parseReais(String(v));
    if (cents === null) redirect(`${back}&editar=1&aviso=valor`);
    await setPackaging(db, who, dish, ch as Channel, cents);
  }
  revalidatePath(`/console/contas/${account.code}/fichas`);
  redirect(back);
}
