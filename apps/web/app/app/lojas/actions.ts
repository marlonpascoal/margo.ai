"use server";
// P13/W02 writes. Dono only (04 §5 "Escolher cozinhas na análise"), re-checked here, audited (A04).
// in_analysis drives units_billed at the next charge (D28, D40); the charge itself is billing's.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isEnabled } from "@/lib/flags";
import { peopleLockUntil } from "@/lib/portal/pessoas";
import { auditPerson, requirePortal } from "@/lib/portal/session";
import { adminClient } from "@/lib/supabase/admin";

const PATH = "/app/lojas";
const back = (aviso?: string): never => redirect(aviso ? `${PATH}?aviso=${encodeURIComponent(aviso)}` : PATH);

/** W02 "Na análise" checkbox. Blocked during the person's own security_lock, like plan changes (04 §8). */
export async function setInAnalysisAction(form: FormData): Promise<void> {
  const m = await requirePortal({ action: "choose_kitchens", flags: ["portal.lojas"] });
  const db = adminClient();
  const kitchenId = String(form.get("cozinha") ?? "");
  const on = form.get("ligar") === "true";
  const { data: k } = await db.from("kitchen").select("id, in_analysis").eq("id", kitchenId).eq("account_id", m.account.id).maybeSingle();
  if (!k) back();
  if (k!.in_analysis === on) back();
  if (await peopleLockUntil(db, m.account.id, m.personId)) back("Você trocou um contato de login. Por 24 horas, você não pode mudar o plano.");
  if (on && !(await isEnabled("conta.multi_cozinha", m.account.id))) {
    const { count } = await db.from("kitchen").select("id", { count: "exact", head: true }).eq("account_id", m.account.id).eq("in_analysis", true);
    if ((count ?? 0) >= 1) back("Seu plano analisa uma cozinha. Para incluir mais, mude o plano.");
  }
  const { error } = await db.from("kitchen").update({ in_analysis: on }).eq("id", kitchenId);
  if (error) throw new Error(error.message);
  await auditPerson(db, m, { action: "kitchen.in_analysis", entity: "kitchen", entityId: kitchenId, before: { in_analysis: !on }, after: { in_analysis: on } });
  revalidatePath(PATH);
  back();
}

/** W02 "Em qual cozinha ela fica?": a store without kitchen joins a kitchen of the account (D29). */
export async function linkNewStoreAction(form: FormData): Promise<void> {
  const m = await requirePortal({ action: "choose_kitchens", flags: ["portal.lojas"] });
  const db = adminClient();
  const storeId = String(form.get("loja") ?? "");
  const kitchenId = String(form.get("cozinha") ?? "");
  if (!kitchenId) back();
  const [{ data: store }, { data: kitchen }] = await Promise.all([
    db.from("channel_store").select("id, name, kitchen_id, brand_id").eq("id", storeId).eq("account_id", m.account.id).maybeSingle(),
    db.from("kitchen").select("id").eq("id", kitchenId).eq("account_id", m.account.id).maybeSingle(),
  ]);
  if (!store || !kitchen || store.kitchen_id) back();
  // The brand of the same name, when the account has one (D29: a store is one brand at one kitchen).
  const { data: brand } = await db.from("brand").select("id").eq("account_id", m.account.id).ilike("name", store!.name).limit(1).maybeSingle();
  const after = { kitchen_id: kitchenId, brand_id: store!.brand_id ?? brand?.id ?? null };
  const { error } = await db.from("channel_store").update(after).eq("id", storeId);
  if (error) throw new Error(error.message);
  await auditPerson(db, m, { action: "channel_store.link", entity: "channel_store", entityId: storeId, before: { kitchen_id: null, brand_id: store!.brand_id }, after });
  revalidatePath(PATH);
  back();
}
