// Reads of the M3 console screens (C12, C13). Every number was computed by worker-cost and stored
// (recipe, recipe_line, contribution, close_decision); nothing here recomputes a rule. Server code only.
import { CHANNEL_ORDER, type Channel } from "@/lib/m2/format";
import type { Db } from "@/lib/supabase/admin";
import type {
  ContributionRecord,
  DecisionRecord,
  PriceSource,
  YieldConfidence,
} from "./format";

export interface DishEntry {
  id: string;
  name: string;
  rank: number | null;
  ready: boolean;
}

/** C12 list: the top-20 dishes in the onboarding order (D15), with their ficha status. */
export async function loadDishes(
  db: Db,
  accountId: string,
): Promise<DishEntry[]> {
  const { data, error } = await db
    .from("menu_item")
    .select("id, name, top20_rank, recipe(status)")
    .eq("account_id", accountId)
    .eq("is_top20", true);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((d) => ({
      id: d.id,
      name: d.name,
      rank: d.top20_rank,
      ready: (d.recipe ?? []).some((r) => r.status === "ready"),
    }))
    .sort(
      (a, b) =>
        (a.rank ?? 99) - (b.rank ?? 99) ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
}

export interface FichaLine {
  id: string;
  ingredient: string;
  baseUnit: string;
  qty: number;
  yieldPct: number;
  confidence: YieldConfidence;
  source: PriceSource | null;
  observedOn: string | null;
  /** 55 NF-e, 65 NFC-e: "nota" or "cupom" (C10, C12). */
  model: number | null;
  costCents: number | null;
}

export interface Ficha {
  recipeId: string;
  menuItemId: string;
  name: string;
  /** null while worker-cost recomputes after an edit. */
  costCents: number | null;
  errorPct: number | null;
  lines: FichaLine[];
  channels: Channel[];
  packaging: Partial<Record<Channel, number>>;
}

/** C12 selected dish: its ready recipe with the stored CST-01 to CST-04 results. */
export async function loadFicha(
  db: Db,
  accountId: string,
  menuItemId: string,
): Promise<Ficha | null> {
  const { data: recipe, error } = await db
    .from("recipe")
    .select(
      "id, cost_cents, error_pct, menu_item(id, name, channel_item_ids), recipe_line(id, qty_base_units, yield_pct, yield_confidence, price_source, price_observed_on, price_per_base_unit_cents, cost_cents, created_at, ingredient(id, name, base_unit))",
    )
    .eq("account_id", accountId)
    .eq("menu_item_id", menuItemId)
    .eq("status", "ready")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!recipe || !recipe.menu_item) return null;
  const lines = [...(recipe.recipe_line ?? [])].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );

  // "nota" or "cupom": the invoice model behind each CST-01 price.
  const invoiceLines = lines.filter(
    (l) => l.price_source === "invoice" && l.ingredient,
  );
  const models = new Map<string, number>();
  if (invoiceLines.length > 0) {
    const { data: prices } = await db
      .from("ingredient_price")
      .select(
        "ingredient_id, observed_on, price_per_base_unit_cents, invoice_line(invoice(model))",
      )
      .eq("account_id", accountId)
      .eq("source", "invoice")
      .in(
        "ingredient_id",
        invoiceLines.map((l) => l.ingredient!.id),
      )
      .in("observed_on", [
        ...new Set(invoiceLines.map((l) => l.price_observed_on!)),
      ]);
    for (const p of prices ?? []) {
      const model = p.invoice_line?.invoice?.model;
      if (model)
        models.set(
          `${p.ingredient_id}|${p.observed_on}|${Number(p.price_per_base_unit_cents)}`,
          model,
        );
    }
  }
  const { data: pack } = await db
    .from("packaging_cost")
    .select("channel, cost_cents")
    .eq("account_id", accountId)
    .eq("menu_item_id", menuItemId);
  const ids = (recipe.menu_item.channel_item_ids ?? {}) as Record<
    string,
    unknown
  >;
  return {
    recipeId: recipe.id,
    menuItemId: recipe.menu_item.id,
    name: recipe.menu_item.name,
    costCents: recipe.cost_cents,
    errorPct: recipe.error_pct === null ? null : Number(recipe.error_pct),
    lines: lines.map((l) => ({
      id: l.id,
      ingredient: l.ingredient?.name ?? "",
      baseUnit: l.ingredient?.base_unit ?? "",
      qty: Number(l.qty_base_units),
      yieldPct: Number(l.yield_pct),
      confidence: l.yield_confidence,
      source: l.price_source,
      observedOn: l.price_observed_on,
      model:
        models.get(
          `${l.ingredient?.id}|${l.price_observed_on}|${Number(l.price_per_base_unit_cents)}`,
        ) ?? null,
      costCents: l.cost_cents === null ? null : Number(l.cost_cents),
    })),
    channels: CHANNEL_ORDER.filter((c) => c in ids),
    packaging: Object.fromEntries(
      (pack ?? []).map((p) => [p.channel, p.cost_cents]),
    ),
  };
}

/** C13 rows of one close: the C12 order (top-20 rank), then units, channel, the row without campaign first. */
export async function loadContribution(
  db: Db,
  closeId: string,
): Promise<ContributionRecord[]> {
  const { data, error } = await db
    .from("contribution")
    .select(
      "menu_item_id, channel, campaign_name, campaign_discount_pct, units, price_cents, channel_take_cents, ingredient_cents, packaging_cents, ingredient_error_pct, left_cents, left_pct, can_invert, menu_item(name, top20_rank)",
    )
    .eq("close_period_id", closeId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => ({
    rank: r.menu_item?.top20_rank ?? 99,
    rec: {
      menuItemId: r.menu_item_id,
      name: r.menu_item?.name ?? "",
      channel: r.channel,
      campaignName: r.campaign_name,
      campaignDiscountPct:
        r.campaign_discount_pct === null
          ? null
          : Number(r.campaign_discount_pct),
      units: r.units,
      priceCents: r.price_cents,
      takeCents: r.channel_take_cents,
      ingredientCents: r.ingredient_cents,
      packagingCents: r.packaging_cents,
      errorPct: Number(r.ingredient_error_pct),
      leftCents: r.left_cents,
      leftPct: r.left_pct === null ? null : Number(r.left_pct),
      canInvert: r.can_invert,
    } satisfies ContributionRecord,
  }));
  const units = new Map<string, number>();
  for (const r of rows)
    units.set(
      r.rec.menuItemId,
      (units.get(r.rec.menuItemId) ?? 0) + r.rec.units,
    );
  return rows
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (units.get(b.rec.menuItemId) ?? 0) -
          (units.get(a.rec.menuItemId) ?? 0) ||
        a.rec.name.localeCompare(b.rec.name, "pt-BR") ||
        CHANNEL_ORDER.indexOf(a.rec.channel) -
          CHANNEL_ORDER.indexOf(b.rec.channel) ||
        Number(a.rec.campaignName !== null) -
          Number(b.rec.campaignName !== null),
    )
    .map((r) => r.rec);
}

/** DLV-01 of one close, or null when there is none (no contribution yet). */
export async function loadDecision(
  db: Db,
  closeId: string,
  month: string,
): Promise<DecisionRecord | null> {
  const { data, error } = await db
    .from("close_decision")
    .select(
      "kind, channel, campaign_discount_pct, left_cents, base_left_cents, menu_item(name)",
    )
    .eq("close_period_id", closeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    kind: data.kind,
    name: data.menu_item?.name ?? "",
    channel: data.channel,
    discountPct:
      data.campaign_discount_pct === null
        ? null
        : Number(data.campaign_discount_pct),
    leftCents: data.left_cents,
    baseLeftCents: data.base_left_cents,
    month,
  };
}

/**
 * E01 "Sobrou depois dos insumos" of a whole close (CTB-01 for the month): payout minus the insumos of the
 * dishes sold, as W01 adds it up. Null when a store has no cost or sold a dish without ficha.
 */
export async function closeLeftCents(
  db: Db,
  closeId: string,
): Promise<number | null> {
  const [{ data: lines, error }, { data: costs, error: costError }] =
    await Promise.all([
      db
        .from("close_line")
        .select("channel_store_id, payout_cents")
        .eq("close_period_id", closeId),
      db
        .from("close_cost_line")
        .select(
          "channel_store_id, uncovered_units, ingredient_cents, packaging_cents",
        )
        .eq("close_period_id", closeId),
    ]);
  if (error) throw new Error(error.message);
  if (costError) throw new Error(costError.message);
  const cost = new Map((costs ?? []).map((c) => [c.channel_store_id, c]));
  let left = 0;
  for (const l of lines ?? []) {
    const c = cost.get(l.channel_store_id);
    if (!c || c.uncovered_units > 0) return null;
    left += l.payout_cents - c.ingredient_cents - c.packaging_cents;
  }
  return (lines ?? []).length > 0 ? left : null;
}
