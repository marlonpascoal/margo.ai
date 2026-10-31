import { describe, expect, it } from "vitest";
import { homeNumbers, type HomeDiff, type HomeLine } from "./home";

const K1 = { id: "k1", name: "Cozinha Centro" };
const K2 = { id: "k2", name: "Cozinha Zona Sul" };
const line = (kitchen: typeof K1 | null, channel: HomeLine["channel"], gross: number, payout: number, insumos: number | null = null): HomeLine => ({
  kitchenId: kitchen?.id ?? null,
  kitchenName: kitchen?.name ?? null,
  channel,
  gross,
  payout,
  insumos,
});
const lines: HomeLine[] = [
  line(K1, "ifood", 100_00, 75_00),
  line(K1, "ifood", 50_00, 40_00),
  line(K1, "food99", 30_00, 25_00),
  line(K2, "ifood", 80_00, 60_00),
  line(null, "ifood", 10_00, 9_00),
];
const diff = (kitchenId: string | null, amount: number, status: HomeDiff["status"], confidence: HomeDiff["confidence"] = "certa"): HomeDiff => ({
  kitchenId,
  amount,
  status,
  confidence,
});
const diffs: HomeDiff[] = [
  diff("k1", 10_00, "a_contestar"),
  diff("k1", 5_00, "contestada"),
  diff("k2", 7_00, "a_contestar"),
  diff("k2", 3_00, "precisa_resposta", "provavel"),
  diff("k1", 99_00, null, "duvidosa"),
];

describe("W01 numbers per scope (A03, REP-05, DIF-xx)", () => {
  it("W01_all_kitchens_sum_every_line_and_group_rows_by_kitchen_and_app", () => {
    const n = homeNumbers(lines, diffs, null);
    expect(n.soldCents).toBe(270_00);
    expect(n.receivedCents).toBe(209_00);
    expect(n.receivedPct).toBe(77);
    expect(n.rows.map((r) => r.label)).toEqual(["Centro · iFood", "Centro · 99Food", "Zona Sul · iFood", "Sem cozinha · iFood"]);
    expect(n.rows[0]).toMatchObject({ soldCents: 150_00, appTookCents: 35_00 });
  });

  it("W01_charged_wrong_sums_owner_visible_differences_and_counts_those_to_contest", () => {
    const n = homeNumbers(lines, diffs, null);
    // duvidosa stays in the console (04 §3).
    expect(n.wrongCents).toBe(25_00);
    expect(n.toContest).toBe(2);
  });

  it("A03_W01_kitchen_filter_keeps_only_that_kitchen", () => {
    const n = homeNumbers(lines.filter((l) => l.kitchenId === "k1"), diffs.filter((d) => d.kitchenId === "k1"), "k1");
    expect(n.soldCents).toBe(180_00);
    expect(n.rows.map((r) => r.label)).toEqual(["Centro · iFood", "Centro · 99Food"]);
    expect(n.wrongCents).toBe(15_00);
    expect(n.toContest).toBe(1);
  });

  it("A03_W01_kitchen_filter_also_applies_when_rows_of_other_kitchens_are_passed", () => {
    const n = homeNumbers(lines, diffs, "k2");
    expect(n.soldCents).toBe(80_00);
    expect(n.rows.map((r) => r.label)).toEqual(["Zona Sul · iFood"]);
    expect(n.toContest).toBe(1);
  });

  it("W01_no_close_gives_zeros", () => {
    const n = homeNumbers([], [], null);
    expect(n).toMatchObject({ soldCents: 0, receivedCents: 0, receivedPct: 0, wrongCents: 0, toContest: 0, rows: [] });
  });

  it("W01_without_cost_sobrou_stays_falta_custo", () => {
    const n = homeNumbers(lines, diffs, null);
    expect(n.leftCents).toBeNull();
    expect(n.rows.every((r) => r.leftCents === null)).toBe(true);
  });
});

describe("W01 sobrou depois dos insumos (CTB-01 for the month)", () => {
  const costed: HomeLine[] = [
    line(K1, "ifood", 100_00, 75_00, 30_00),
    line(K1, "ifood", 50_00, 40_00, 15_00),
    line(K1, "food99", 30_00, 25_00, 10_00),
    line(K2, "ifood", 80_00, 60_00, 20_00),
  ];

  it("W01_sobrou_is_received_minus_insumos_per_row_and_in_total", () => {
    const n = homeNumbers(costed, [], null);
    expect(n.rows.map((r) => [r.label, r.leftCents])).toEqual([
      ["Centro · iFood", 70_00],
      ["Centro · 99Food", 15_00],
      ["Zona Sul · iFood", 40_00],
    ]);
    expect(n.leftCents).toBe(125_00);
    expect(n.leftPct).toBe(48); // of 260,00 sold
  });

  it("A03_W01_sobrou_follows_the_kitchen_filter", () => {
    expect(homeNumbers(costed, [], "k2").leftCents).toBe(40_00);
  });

  it("W01_a_row_with_a_dish_without_ficha_shows_falta_custo_and_so_does_the_total", () => {
    const n = homeNumbers([...costed, line(K2, "food99", 10_00, 8_00, null)], [], null);
    expect(n.rows.find((r) => r.label === "Zona Sul · 99Food")?.leftCents).toBeNull();
    expect(n.rows.find((r) => r.label === "Zona Sul · iFood")?.leftCents).toBe(40_00);
    expect(n.leftCents).toBeNull();
  });
});
