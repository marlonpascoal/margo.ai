import { describe, expect, it } from "vitest";
import { homeNumbers, type HomeDiff, type HomeLine } from "./home";

const K1 = { id: "k1", name: "Cozinha Centro" };
const K2 = { id: "k2", name: "Cozinha Zona Sul" };
const line = (kitchen: typeof K1 | null, channel: HomeLine["channel"], gross: number, payout: number): HomeLine => ({
  kitchenId: kitchen?.id ?? null,
  kitchenName: kitchen?.name ?? null,
  channel,
  gross,
  payout,
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
});
