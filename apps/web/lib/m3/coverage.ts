// C10 and P05 "Cobertura dos 20 insumos que mais pesam" (04 §4 CST-01, rule_param m3.price_window_days).
// Which insumos weigh most comes from the dishes' recipes; each one's CST-01 price is the latest confirmed
// invoice price observed within the window (only confirmed matches write ingredient_price rows, D14).
import type { Db } from "@/lib/supabase/admin";
import type { BaseUnit } from "./format";
import type { TopIngredient } from "./notas";

async function param(db: Db, key: string, fallback: number): Promise<number> {
  const { data } = await db.from("rule_param").select("value").eq("key", key).maybeSingle();
  return data ? Number(data.value) : fallback;
}

/** Latest CST-01 invoice price per ingredient of the account, within the window ending at `asOf`. */
export async function latestInvoicePrices(db: Db, accountId: string, asOf: string): Promise<Map<string, TopIngredient["price"]>> {
  const days = await param(db, "m3.price_window_days", 90);
  const from = new Date(new Date(`${asOf}T12:00:00Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db
    .from("ingredient_price")
    .select("ingredient_id, price_per_base_unit_cents, observed_on, invoice_line(invoice(model))")
    .eq("account_id", accountId)
    .eq("source", "invoice")
    .gte("observed_on", from)
    .lte("observed_on", asOf)
    .order("observed_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const out = new Map<string, TopIngredient["price"]>();
  for (const r of data ?? []) {
    if (out.has(r.ingredient_id)) continue;
    out.set(r.ingredient_id, { centsPerBase: Number(r.price_per_base_unit_cents), observedOn: r.observed_on, model: r.invoice_line?.invoice.model ?? 55 });
  }
  return out;
}

export interface Ranked {
  id: string;
  name: string;
  short_name: string | null;
  base_unit: BaseUnit;
}

/** The top insumos of the account (m3.top_ingredients, default 20), most weight first. */
export async function rankedIngredients(db: Db, accountId: string): Promise<Ranked[]> {
  const n = await param(db, "m3.top_ingredients", 20);
  const { data, error } = await db
    .from("recipe_line")
    .select("ingredient_id, qty_base_units, yield_pct, ingredient(name, short_name, base_unit), recipe!inner(menu_item!inner(is_top20))")
    .eq("account_id", accountId)
    .eq("recipe.menu_item.is_top20", true);
  if (error) throw new Error(error.message);
  const weight = new Map<string, { r: Ranked; w: number }>();
  for (const l of data ?? []) {
    const cur = weight.get(l.ingredient_id) ?? { r: { id: l.ingredient_id, name: l.ingredient.name, short_name: l.ingredient.short_name, base_unit: l.ingredient.base_unit }, w: 0 };
    cur.w += Number(l.qty_base_units) / Number(l.yield_pct);
    weight.set(l.ingredient_id, cur);
  }
  return [...weight.values()].sort((a, b) => b.w - a.w || a.r.name.localeCompare(b.r.name)).slice(0, n).map((x) => x.r);
}

export async function topIngredients(db: Db, accountId: string, asOf: string): Promise<TopIngredient[]> {
  const [ranked, prices] = await Promise.all([rankedIngredients(db, accountId), latestInvoicePrices(db, accountId, asOf)]);
  return ranked.map((r) => ({ ...r, price: prices.get(r.id) ?? null }));
}
