// M3 on the local stack with the G-SYN seed: C12 writes are audited (A04) and queue worker-cost; W01's KPIs
// equal C08 and C13 for the same month and scope (05 P08/W01 "Done when"). Rows a test changes are restored.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { EnqueueDeps } from "@/lib/jobs/enqueue";
import { SupabaseJobQueue } from "@/lib/jobs/supabase-queue";
import { loadClose } from "@/lib/m2/close";
import { homeNumbers, loadHomeDiffs, loadHomeLines } from "@/lib/portal/home";
import { adminClient } from "@/lib/supabase/admin";
import {
  closeLeftCents,
  loadContribution,
  loadDecision,
  loadDishes,
  loadFicha,
} from "./data";
import { editRecipeLine, setPackaging } from "./edit";

const db = adminClient();
const sid = (tag: string) => {
  const h = createHash("md5").update(`g-syn:${tag}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const G02 = sid("G-02");
const CLOSE = sid("G-02:close:2026-09");
const MARLON = sid("p:marlon");
const META = { ip: "127.0.0.1", userAgent: "vitest" };
const deps: EnqueueDeps = {
  queue: new SupabaseJobQueue(db),
  agentUrl: () => null,
  signingKey: () => Buffer.alloc(32),
  wake: async () => {},
  now: () => new Date(),
};
const cleanup: (() => PromiseLike<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("C12 reads the stored CST results", () => {
  it("C12_list_and_xbacon_ficha_as_drawn", async () => {
    const dishes = await loadDishes(db, G02);
    expect(dishes).toHaveLength(20);
    expect(dishes.filter((d) => d.ready)).toHaveLength(8);
    expect(dishes.slice(0, 7).map((d) => [d.name, d.ready])).toEqual([
      ["X-Bacon artesanal", true],
      ["Smash duplo", true],
      ["Batata frita média", true],
      ["Combo casal", true],
      ["Milkshake 400 ml", true],
      ["Cheddar burger", false],
      ["Onion rings", false],
    ]);
    const f = await loadFicha(db, G02, sid("G-02:dish:xbacon"));
    expect(f).toMatchObject({ costCents: 1244, name: "X-Bacon artesanal" });
    expect(
      f!.lines.map((l) => [
        l.ingredient,
        l.source,
        l.observedOn,
        l.model,
        Math.round(l.costCents!),
      ]),
    ).toEqual([
      ["Carne bovina moída (blend)", "invoice", "2026-10-12", 55, 732],
      ["Queijo cheddar fatiado", "invoice", "2026-09-30", 55, 146],
      ["Bacon em cubos", "regional_prior", "2026-10-01", null, 138],
      ["Pão brioche", "invoice", "2026-10-05", 55, 115],
      ["Maionese (base de molho)", "invoice", "2026-09-18", 55, 23],
      ["Embalagem kraft", "regional_prior", "2026-10-01", null, 90],
    ]);
    const refri = await loadFicha(db, G02, sid("G-02:dish:refri"));
    expect(refri!.lines[0]).toMatchObject({
      model: 65,
      observedOn: "2026-10-03",
    }); // "cupom de 03/out"
  });
});

describe("A04 C12 writes", () => {
  it("A04_C12_line_edit_is_audited_clears_the_cost_and_queues_compute_contribution", async () => {
    const lineId = sid("G-02:recipe:smash:1");
    const recipeId = sid("G-02:recipe:smash");
    const { data: line } = await db
      .from("recipe_line")
      .select("qty_base_units, yield_pct, yield_confidence, cost_cents")
      .eq("id", lineId)
      .single();
    const { data: recipe } = await db
      .from("recipe")
      .select("cost_cents, error_pct, cost_computed_at")
      .eq("id", recipeId)
      .single();
    const since = new Date().toISOString();
    cleanup.push(async () => {
      await db.from("recipe_line").update(line!).eq("id", lineId);
      await db.from("recipe").update(recipe!).eq("id", recipeId);
      await db
        .from("job")
        .delete()
        .eq("type", "compute_contribution")
        .gte("created_at", since);
    });
    await editRecipeLine(
      db,
      { staffId: MARLON, accountId: G02, meta: META, deps },
      lineId,
      { qty: 180, yieldPct: 0.8, confidence: "medido" },
    );
    const { data: audit } = await db
      .from("audit_log")
      .select("action, entity_id, before, after, actor_kind")
      .eq("entity_id", lineId)
      .gte("at", since);
    expect(audit).toEqual([
      {
        action: "recipe_line.update",
        entity_id: lineId,
        actor_kind: "staff",
        before: {
          qty_base_units: 180,
          yield_pct: 0.85,
          yield_confidence: "declarado",
        },
        after: {
          qty_base_units: 180,
          yield_pct: 0.8,
          yield_confidence: "medido",
        },
      },
    ]);
    expect(
      (await db.from("recipe").select("cost_cents").eq("id", recipeId).single())
        .data!.cost_cents,
    ).toBeNull();
    const { data: jobs } = await db
      .from("job")
      .select("payload, status, account_id")
      .eq("type", "compute_contribution")
      .gte("created_at", since);
    expect(jobs).toEqual([
      { payload: { account_id: G02 }, status: "queued", account_id: G02 },
    ]);
  });

  it("A04_C12_packaging_is_audited_and_unchanged_values_write_nothing", async () => {
    const dish = sid("G-02:dish:xbacon");
    const since = new Date().toISOString();
    cleanup.push(async () => {
      await db.from("packaging_cost").delete().eq("menu_item_id", dish);
      await db
        .from("job")
        .delete()
        .eq("type", "compute_contribution")
        .gte("created_at", since);
    });
    await setPackaging(
      db,
      { staffId: MARLON, accountId: G02, meta: META, deps },
      dish,
      "food99",
      0,
    );
    expect(
      (
        await db
          .from("audit_log")
          .select("id")
          .eq("action", "packaging_cost.set")
          .gte("at", since)
      ).data,
    ).toHaveLength(0);
    await setPackaging(
      db,
      { staffId: MARLON, accountId: G02, meta: META, deps },
      dish,
      "food99",
      30,
    );
    const { data: audit } = await db
      .from("audit_log")
      .select("after")
      .eq("action", "packaging_cost.set")
      .gte("at", since);
    expect(audit).toEqual([
      { after: { menu_item_id: dish, channel: "food99", cost_cents: 30 } },
    ]);
  });
});

describe("C13 and W01 on the September close", () => {
  it("C13_rows_and_DLV01_decision_as_drawn", async () => {
    const rows = await loadContribution(db, CLOSE);
    expect(
      rows.slice(0, 2).map((r) => [r.name, r.channel, r.leftCents]),
    ).toEqual([
      ["X-Bacon artesanal", "ifood", 1505],
      ["X-Bacon artesanal", "food99", 1627],
    ]);
    const coupon = rows.find((r) => r.campaignName !== null)!;
    expect(coupon).toMatchObject({
      name: "Combo casal",
      priceCents: 6392,
      takeCents: 1630,
      ingredientCents: 3180,
      leftCents: 1582,
    });
    expect(await loadDecision(db, CLOSE, "2026-09-01")).toMatchObject({
      kind: "campaign",
      name: "Combo casal",
      leftCents: 1582,
      baseLeftCents: 2773,
    });
  });

  it("W01_kpis_equal_C08_and_C13_for_the_same_month_and_scope", async () => {
    const { lines: c08 } = await loadClose(db, CLOSE);
    const c13 = await loadContribution(db, CLOSE);
    const received = c08.reduce((a, l) => a + l.payout, 0);
    const insumos = c13.reduce(
      (a, r) => a + r.units * (r.ingredientCents + r.packagingCents),
      0,
    );

    const dono = {
      allKitchens: true,
      kitchenIds: [
        sid("G-02:centro"),
        sid("G-02:zonasul"),
        sid("G-02:shopping"),
      ],
    };
    const n = homeNumbers(
      await loadHomeLines(db, CLOSE, dono),
      await loadHomeDiffs(db, CLOSE, dono),
      null,
    );
    expect(n.soldCents).toBe(c08.reduce((a, l) => a + l.gross, 0));
    expect(n.receivedCents).toBe(received);
    expect(n.leftCents).toBe(received - insumos);
    expect(n.leftCents).toBe(await closeLeftCents(db, CLOSE)); // E01 says the same
    expect(n.rows.every((r) => r.leftCents !== null)).toBe(true);

    // A03: the Gerente do Centro gets Centro only, from the Centro stores' own sales.
    const gerente = { allKitchens: false, kitchenIds: [sid("G-02:centro")] };
    const g = homeNumbers(await loadHomeLines(db, CLOSE, gerente), [], null);
    expect(g.rows.map((r) => r.label)).toEqual([
      "Centro · iFood",
      "Centro · 99Food",
    ]);
    const centro = ["s1", "s2", "s3"].map((s) => sid(`G-02:${s}`));
    const { data: cl } = await db
      .from("close_line")
      .select("payout_cents")
      .eq("close_period_id", CLOSE)
      .in("channel_store_id", centro);
    const { data: cc } = await db
      .from("close_cost_line")
      .select("ingredient_cents, packaging_cents")
      .eq("close_period_id", CLOSE)
      .in("channel_store_id", centro);
    expect(g.leftCents).toBe(
      cl!.reduce((a, l) => a + l.payout_cents, 0) -
        cc!.reduce((a, c) => a + c.ingredient_cents + c.packaging_cents, 0),
    );
  });
});
