// M1 screens: formats, the C02 link rule, the P02 text, counts and orders shown in C03 to C05, and the
// commands (each write goes through its audited SQL function, then enqueues its job).
import { describe, expect, it } from "vitest";
import { calculate, confirmStores, createXray, markDelivered, prepareDelivery, reviewItem, saveMinutes, setStoreIncluded, type XrayDeps } from "./commands";
import { gapLabel, hoursLabel, kmLabel, money, parseHours, shareLabel } from "./format";
import { canonicalStoreUrl, storeIdFromUrl } from "./ifood-url";
import { collectStopReason, pairStatusLabel } from "./labels";
import { signupLink, whatsappLink, xrayMessage } from "./P02-whatsapp-raio-x";
import { examplePair, mapOffset, neighborhoodCounts, pairingTotals, pendingReview, priceHistory, storeState, xrayResult, type ItemRow } from "./view";

const PANTANOS = "https://www.ifood.com.br/delivery/londrina-pr/pantanos-burguer-igapo/91a9c35d-0000-4000-8000-000000000000";

describe("formats", () => {
  it("money, gaps, shares, distances and hours as drawn", () => {
    expect([money(500), money(1490), money(149000), money(-1200)]).toEqual(["R$ 5,00", "R$ 14,90", "R$ 1.490,00", "-R$ 12,00"]);
    expect([gapLabel(-0.2308), gapLabel(0.1714), gapLabel(-0.0197), gapLabel(0), gapLabel(null)]).toEqual(["−23%", "+17%", "−2%", "0%", ""]);
    expect([shareLabel(0.31), shareLabel("0.5307"), shareLabel(0.8007)]).toEqual(["31%", "53%", "80%"]);
    expect([kmLabel(400), kmLabel(2896), kmLabel(1249)]).toEqual(["0,4 km", "2,9 km", "1,2 km"]);
    expect([hoursLabel(30), hoursLabel(60), hoursLabel(18)]).toEqual(["0,5", "1,0", "0,3"]);
    expect([parseHours("0,5"), parseHours("1"), parseHours("1.25"), parseHours("abc"), parseHours("-1"), parseHours("30")]).toEqual([30, 60, 75, null, null, null]);
  });
});

describe("C02 link (D29)", () => {
  it("takes the iFood uuid at the end of the URL and rejects anything else", () => {
    expect(storeIdFromUrl(PANTANOS)).toBe("91a9c35d-0000-4000-8000-000000000000");
    expect(storeIdFromUrl("ifood.com.br/delivery/londrina-pr/x/91A9C35D-0000-4000-8000-000000000000/?utm=1")).toBe("91a9c35d-0000-4000-8000-000000000000");
    expect(storeIdFromUrl("https://www.ifood.com.br/delivery/londrina-pr/pantanos-burguer-igapo")).toBeNull();
    expect(storeIdFromUrl("https://www.rappi.com.br/delivery/a/b/91a9c35d-0000-4000-8000-000000000000")).toBeNull();
    expect(storeIdFromUrl("não é link")).toBeNull();
    expect(canonicalStoreUrl("ifood.com.br/delivery/a/b/c/?x=1")).toBe("https://www.ifood.com.br/delivery/a/b/c");
  });
});

describe("P02 text in C06", () => {
  it("C06_message_is_the_drawn_text_with_the_xray_numbers_and_the_ref_link", () => {
    const link = signupLink("http://localhost:3108/", "abc");
    expect(link).toBe("http://localhost:3108/criar-conta?ref=abc");
    expect(xrayMessage({ storeName: "Pantanos Burguer", storesCompared: 84, radiusKm: 3, itemsToRaise: 3, link })).toBe(
      "Oi! Fizemos um raio-X dos preços da Pantanos Burguer comparando com 84 lojas num raio de 3 km. Tem 3 itens que dá para subir hoje sem risco. " +
        "O PDF está aqui. Para saber o que dá lucro de verdade, dá para conectar o iFood em 2 minutos: http://localhost:3108/criar-conta?ref=abc",
    );
    expect(whatsappLink("Oi! a&b")).toBe("https://wa.me/?text=Oi!%20a%26b");
    expect(xrayMessage({ storeName: "X", storesCompared: 1, radiusKm: 2, itemsToRaise: 1, link })).toContain("Tem 1 item que dá");
    expect(xrayMessage({ storeName: "X", storesCompared: 1, radiusKm: 2, itemsToRaise: 3, link })).not.toContain("—");
  });
});

describe("C03", () => {
  it("counts and the reason shown for every store", () => {
    const rows = [
      { included: true, reason: null },
      { included: false, reason: "regra: rede tabelada" },
      { included: false, reason: "manual" },
      { included: true, reason: "manual" },
    ];
    expect(neighborhoodCounts(rows)).toEqual({ found: 4, inSet: 2, excluded: 2 });
    expect(rows.map(storeState)).toEqual(["no conjunto", "regra: rede tabelada", "manual", "no conjunto"]);
    const north = mapOffset({ lat: -23.338, lng: -51.158 }, { lat: -23.338 + 1 / 111.195, lng: -51.158 }, 50);
    expect([Math.round(north.x), Math.round(north.y)]).toEqual([0, -50]);
  });

  it("B02_C03_shows_why_the_collection_stopped", () => {
    expect(collectStopReason("CaptchaBlock")).toBe("Coleta parada: o iFood pediu captcha. Nada foi contornado.");
    expect(collectStopReason("AwaitingRecordings")).toContain("fixtures/m1");
    expect(collectStopReason(null, "flag_off")).toContain("desligado");
  });
});

const item = (o: Partial<ItemRow>): ItemRow => ({
  id: o.name ?? "i",
  name: "i",
  ownCents: 100,
  normUnit: "un",
  normPriceCents: 100,
  parityCents: 100,
  gapPct: 0,
  lossCents: 0,
  reading: "na_media",
  pairStatus: "auto",
  pairNote: null,
  reviewed: false,
  skipped: false,
  paretoRank: null,
  paretoCumShare: null,
  comparables: 5,
  exampleName: null,
  exampleCents: null,
  ...o,
});

describe("C04", () => {
  it("chips, status words, the example pair and the calculate gate", () => {
    const items = [
      item({ pairStatus: "auto" }),
      item({ pairStatus: "normalizado", normUnit: "100g", exampleName: "Batata frita 400 g", exampleCents: 2453 }),
      item({ pairStatus: "revisar", pairNote: "poucos pares" }),
      item({ pairStatus: "revisar", pairNote: "combos diferentes", reviewed: true }),
    ];
    expect(pairingTotals(items)).toEqual({ items: 4, auto: 1, review: 2, normalized: 1 });
    expect(pairStatusLabel("revisar", "poucos pares")).toBe("revisar: poucos pares");
    expect(pairStatusLabel("auto", null)).toBe("pareado");
    expect(examplePair(items[1], money)).toBe("Batata frita 400 g, R$ 24,53");
    expect(examplePair(item({ exampleName: "Lata 350 ml", exampleCents: 650 }), money)).toBe("Lata 350 ml");
    expect(pendingReview(items)).toBe(1);
    expect(pendingReview([items[0], items[3], item({ pairStatus: "revisar", skipped: true })])).toBe(0);
  });
});

describe("C05", () => {
  it("C05_kpis_table_order_and_pareto_count_come_from_the_rows", () => {
    const items = [
      item({ name: "Smash duplo", gapPct: -0.0197, reading: "na_media", lossCents: 1200, paretoRank: 3, paretoCumShare: 0.95 }),
      item({ name: "Batata", gapPct: -0.1902, reading: "pode_subir", lossCents: 21700, paretoRank: 1, paretoCumShare: 0.6 }),
      item({ name: "Refri", gapPct: -0.2308, reading: "pode_subir", lossCents: 15450, paretoRank: 2, paretoCumShare: 0.85 }),
      item({ name: "X-Bacon", gapPct: 0.1714, reading: "nao_mexer", lossCents: -16200 }),
      item({ name: "Combo", gapPct: 0.1431, reading: "nao_mexer", lossCents: -8000 }),
      item({ name: "Sundae", parityCents: null, reading: null, skipped: true }),
    ];
    const r = xrayResult(items);
    expect([r.analyzed, r.below, r.above, r.paretoCount, r.toRaise]).toEqual([5, 2, 2, 2, 2]);
    expect(r.rows.map((i) => i.name)).toEqual(["Refri", "Batata", "Smash duplo", "X-Bacon", "Combo"]);
    expect(r.pareto).toEqual([
      { name: "Batata", width: 100, cumShare: 0.6 },
      { name: "Refri", width: 71, cumShare: 0.85 },
    ]);
  });
});

describe("commands (A04: every write through an audited function)", () => {
  function fake() {
    const calls: [string, Record<string, unknown>][] = [];
    const jobs: { type: string; payload: Record<string, unknown>; accountId: string | null; dedupeKey: string }[] = [];
    const deps: XrayDeps = {
      rpc: async (fn, args) => {
        calls.push([fn, args]);
        return fn === "xray_create" ? "x-1" : null;
      },
      enqueue: async (j) => {
        jobs.push(j);
      },
    };
    return { calls, jobs, deps };
  }
  const actor = { personId: "p-1", ip: "127.0.0.1", userAgent: "ua" };

  it("C02_buscar_vizinhanca_creates_the_xray_and_a_collect_job", async () => {
    const { calls, jobs, deps } = fake();
    const r = await createXray(deps, actor, { url: PANTANOS, radiusKm: 3, category: "lanches", excludeClosed: true, excludeChains: true, sameNeighborhoodOnly: false }, async () => "acc-1");
    expect(r).toEqual({ ok: true, xrayId: "x-1" });
    expect(calls[0]).toEqual([
      "xray_create",
      {
        p_external_id: "91a9c35d-0000-4000-8000-000000000000",
        p_url: PANTANOS,
        p_radius_km: 3,
        p_categories: ["Lanches", "Hambúrguer", "Porções"],
        p_rules: { exclude_closed: true, exclude_national_chains: true, same_neighborhood_only: false },
        p_actor: "p-1",
        p_ip: "127.0.0.1",
        p_user_agent: "ua",
      },
    ]);
    expect(jobs).toEqual([{ type: "collect", payload: { xray_id: "x-1" }, accountId: "acc-1", dedupeKey: "collect:x-1" }]);
  });

  it("C02_invalid_or_non_ifood_url_is_rejected_without_writing", async () => {
    const { calls, jobs, deps } = fake();
    for (const url of ["https://www.rappi.com.br/x", "", "ifood.com.br/delivery/londrina-pr/x"]) {
      expect(await createXray(deps, actor, { url, radiusKm: 3, category: "lanches", excludeClosed: true, excludeChains: true, sameNeighborhoodOnly: false }, async () => null)).toEqual({
        ok: false,
        field: "url",
      });
    }
    expect(await createXray(deps, actor, { url: PANTANOS, radiusKm: 4, category: "lanches", excludeClosed: true, excludeChains: true, sameNeighborhoodOnly: false }, async () => null)).toEqual({
      ok: false,
      field: "form",
    });
    expect(calls).toEqual([]);
    expect(jobs).toEqual([]);
  });

  it("A04_each_step_calls_its_audited_function_and_enqueues_its_job", async () => {
    const { calls, jobs, deps } = fake();
    await setStoreIncluded(deps, actor, "s-1", false);
    await confirmStores(deps, actor, "x-1", "acc");
    await reviewItem(deps, actor, "i-1", ["p-1"]);
    await calculate(deps, actor, "x-1", "acc");
    await prepareDelivery(deps, actor, "x-1", "acc");
    await markDelivered(deps, actor, "x-1", "Oi!");
    await saveMinutes(deps, actor, "x-1", { vizinhanca: 30 });
    expect(calls.map((c) => c[0])).toEqual([
      "xray_store_set_included",
      "xray_confirm_stores",
      "xray_item_review",
      "xray_calculate",
      "xray_prepare_delivery",
      "xray_mark_delivered",
      "time_log_save",
    ]);
    expect(calls.every(([, a]) => a.p_actor === "p-1")).toBe(true);
    expect(jobs.map((j) => j.type)).toEqual(["xray_pair", "xray_calc", "render_xray"]);
  });
});

describe("C05 history (M1 history, M1-10)", () => {
  it("B01_history: runs oldest first, a price per run, changed items first", () => {
    const runs = [
      { xrayId: "b", collectedAt: "2026-10-28T13:00:00Z", rank: { rank: 31, of: 85, priceIndex: 0.96 } },
      { xrayId: "a", collectedAt: "2026-09-28T13:00:00Z", rank: { rank: 24, of: 80, priceIndex: 0.94 } },
    ];
    const prices = [
      { xrayId: "a", itemId: "1", name: "Batata", priceCents: 1500 },
      { xrayId: "b", itemId: "1", name: "Batata", priceCents: 1500 },
      { xrayId: "a", itemId: "2", name: "X-Bacon", priceCents: 2900 },
      { xrayId: "b", itemId: "2", name: "X-Bacon", priceCents: 3100 },
      { xrayId: "b", itemId: "3", name: "Açaí", priceCents: 1200 },
    ];
    const h = priceHistory(runs, prices);
    expect(h.runs.map((r) => r.xrayId)).toEqual(["a", "b"]);
    expect(h.items.map((i) => [i.name, i.cells, i.changed])).toEqual([
      ["X-Bacon", [2900, 3100], true],
      ["Açaí", [null, 1200], false],
      ["Batata", [1500, 1500], false],
    ]);
    expect(priceHistory(runs, prices, 1).runs.map((r) => r.xrayId)).toEqual(["b"]);
  });
});

describe("history labels", () => {
  it("run dates in São Paulo time and the target kind", async () => {
    const { runDateLabel } = await import("./format");
    const { TARGET_KIND_LABEL } = await import("./labels");
    expect(runDateLabel("2026-10-28T13:00:00Z")).toBe("28/out");
    expect(runDateLabel("2026-10-01T02:00:00Z")).toBe("30/set");
    expect(TARGET_KIND_LABEL.own).toBe("loja própria");
  });
});
