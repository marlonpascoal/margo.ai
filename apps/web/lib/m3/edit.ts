// C12 writes: a recipe line (quantity, yield, yield confidence) and the packaging of a dish per channel.
// Staff only, audited (A04); the stored costs are cleared and worker-cost recomputes them (compute_contribution).
import type { Database } from "@margoai/contracts";
import { enqueueJob, type EnqueueDeps } from "@/lib/jobs/enqueue";
import { enqueueDeps } from "@/lib/jobs/deps";
import { audit } from "@/lib/m2/account";
import type { Channel } from "@/lib/m2/format";
import type { Db } from "@/lib/supabase/admin";

type Confidence = Database["public"]["Enums"]["yield_confidence"];
const CONFIDENCES: Confidence[] = ["medido", "declarado", "estimado"];

export interface LineEdit {
  qty: number;
  /** Fraction (0.85 for 85%). */
  yieldPct: number;
  confidence: Confidence;
}

/** "160", "12,5"; "85" or "85%" as a fraction. Null when the value cannot be a recipe line (CST-03 needs yield > 0). */
export function parseLineEdit(
  qty: string,
  yieldPct: string,
  confidence: string,
): LineEdit | null {
  const q = Number(qty.replace(",", ".").trim());
  const y = Number(yieldPct.replace("%", "").replace(",", ".").trim()) / 100;
  if (!Number.isFinite(q) || q <= 0 || q > 100_000) return null;
  if (!Number.isFinite(y) || y <= 0 || y > 3) return null;
  if (!CONFIDENCES.includes(confidence as Confidence)) return null;
  return {
    qty: q,
    yieldPct: Math.round(y * 10_000) / 10_000,
    confidence: confidence as Confidence,
  };
}

/** "0,30" or "0.3" reais to centavos; null when not a non-negative amount. */
export function parseReais(v: string): number | null {
  const s = v
    .replace(/\s|R\$/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  if (s === "") return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) return null;
  return Math.round(n * 100);
}

interface Who {
  staffId: string;
  accountId: string;
  meta: { ip: string | null; userAgent: string | null };
  /** Queue wiring; tests pass a recorder. */
  deps?: EnqueueDeps;
}

async function recompute(
  db: Db,
  recipeId: string | null,
  accountId: string,
  deps: EnqueueDeps = enqueueDeps(),
): Promise<void> {
  if (recipeId) {
    const { error } = await db
      .from("recipe")
      .update({ cost_cents: null, error_pct: null, cost_computed_at: null })
      .eq("id", recipeId);
    if (error) throw new Error(error.message);
  }
  await enqueueJob(deps, {
    type: "compute_contribution",
    payload: { account_id: accountId },
    accountId,
    dedupeKey: `compute_contribution:${accountId}`,
  });
}

/** C12 "edit lines": quantity, yield and its confidence of one line (CST-03, CST-04). */
export async function editRecipeLine(
  db: Db,
  who: Who,
  lineId: string,
  edit: LineEdit,
): Promise<void> {
  const { data: before, error } = await db
    .from("recipe_line")
    .select("id, recipe_id, qty_base_units, yield_pct, yield_confidence")
    .eq("id", lineId)
    .eq("account_id", who.accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!before) throw new Error("recipe line not found");
  const after = {
    qty_base_units: edit.qty,
    yield_pct: edit.yieldPct,
    yield_confidence: edit.confidence,
  };
  const upd = await db
    .from("recipe_line")
    .update({ ...after, cost_cents: null })
    .eq("id", lineId);
  if (upd.error) throw new Error(upd.error.message);
  await audit(db, {
    actor: who.staffId,
    accountId: who.accountId,
    action: "recipe_line.update",
    entity: "recipe_line",
    entityId: lineId,
    before: {
      qty_base_units: Number(before.qty_base_units),
      yield_pct: Number(before.yield_pct),
      yield_confidence: before.yield_confidence,
    },
    after,
    meta: who.meta,
  });
  await recompute(db, before.recipe_id, who.accountId, who.deps);
}

/** C12 packaging of a dish on one channel (CTB-01 packaging term). */
export async function setPackaging(
  db: Db,
  who: Who,
  menuItemId: string,
  channel: Channel,
  costCents: number,
): Promise<void> {
  const { data: before } = await db
    .from("packaging_cost")
    .select("id, cost_cents")
    .eq("account_id", who.accountId)
    .eq("menu_item_id", menuItemId)
    .eq("channel", channel)
    .maybeSingle();
  if ((before?.cost_cents ?? 0) === costCents) return;
  const res = before
    ? await db
        .from("packaging_cost")
        .update({ cost_cents: costCents })
        .eq("id", before.id)
        .select("id")
        .single()
    : await db
        .from("packaging_cost")
        .insert({
          account_id: who.accountId,
          menu_item_id: menuItemId,
          channel,
          cost_cents: costCents,
        })
        .select("id")
        .single();
  if (res.error) throw new Error(res.error.message);
  await audit(db, {
    actor: who.staffId,
    accountId: who.accountId,
    action: "packaging_cost.set",
    entity: "packaging_cost",
    entityId: res.data.id,
    before: before ? { channel, cost_cents: before.cost_cents } : null,
    after: { menu_item_id: menuItemId, channel, cost_cents: costCents },
    meta: who.meta,
  });
  await recompute(db, null, who.accountId, who.deps);
}
