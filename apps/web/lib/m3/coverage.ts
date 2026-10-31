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

/** Units of each dish sold in the latest computed close (contribution.units, worker-cost). */
async function unitsByDish(db: Db, accountId: string): Promise<Map<string, number>> {
  const { data: close } = await db.from("close_period").select("id").eq("account_id", accountId).not("computed_at", "is", null).order("month", { ascending: false }).limit(1).maybeSingle();
  const out = new Map<string, number>();
  if (!close) return out;
  const { data, error } = await db.from("contribution").select("menu_item_id, units").eq("close_period_id", close.id);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) out.set(r.menu_item_id, (out.get(r.menu_item_id) ?? 0) + r.units);
  return out;
}

/** The insumos that weigh most in the cost of the dishes sold (m3.top_ingredients, default 20): line cost of
 * the ready recipes (CST-03, written by worker-cost) times units of the dish sold, as margo_cost computes it
 * for P06. Also returns the date those costs were computed, the date CST-01 is read at. */
export async function rankedIngredients(db: Db, accountId: string): Promise<{ ranked: Ranked[]; asOf: string | null }> {
  const n = await param(db, "m3.top_ingredients", 20);
  const [units, lines] = await Promise.all([
    unitsByDish(db, accountId),
    db
      .from("recipe_line")
      .select("ingredient_id, cost_cents, ingredient(name, short_name, base_unit), recipe!inner(menu_item_id, status, cost_as_of)")
      .eq("account_id", accountId)
      .eq("recipe.status", "ready"),
  ]);
  if (lines.error) throw new Error(lines.error.message);
  const weight = new Map<string, { r: Ranked; w: number }>();
  let asOf: string | null = null;
  for (const l of lines.data ?? []) {
    if (l.recipe.cost_as_of && (!asOf || l.recipe.cost_as_of > asOf)) asOf = l.recipe.cost_as_of;
    const cur = weight.get(l.ingredient_id) ?? { r: { id: l.ingredient_id, name: l.ingredient.name, short_name: l.ingredient.short_name, base_unit: l.ingredient.base_unit }, w: 0 };
    cur.w += Number(l.cost_cents ?? 0) * (units.get(l.recipe.menu_item_id) ?? 0);
    weight.set(l.ingredient_id, cur);
  }
  const ranked = [...weight.values()].sort((a, b) => b.w - a.w || a.r.id.localeCompare(b.r.id)).slice(0, n).map((x) => x.r);
  return { ranked, asOf };
}

/** C10 rows: each top insumo with its CST-01 price at the date the costs were computed (else today). */
export async function topIngredients(db: Db, accountId: string, today: string): Promise<TopIngredient[]> {
  const { ranked, asOf } = await rankedIngredients(db, accountId);
  const prices = await latestInvoicePrices(db, accountId, asOf ?? today);
  return ranked.map((r) => ({ ...r, price: prices.get(r.id) ?? null }));
}
