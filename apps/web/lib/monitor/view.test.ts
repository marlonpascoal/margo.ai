// B01 owner journey screens, pure parts (lib/monitor/view.ts): the words and numbers the prototype draws.
import { describe, expect, it } from "vitest";
import type { History, MonitorSummary, ResultItem, TestItem, TestPoint } from "./load";
import {
  byGroup,
  mapDots,
  dayMon,
  gapWords,
  headline,
  linePaths,
  monitorPill,
  nextRunText,
  periodLabel,
  planLine,
  positionChange,
  positionWords,
  progressSegments,
  rankChangeSince,
  rankDelta,
  readSoFar,
  readingGroups,
  runLabel,
  runNumber,
  scoreChangeSince,
  scoreDelta,
  stepTexts,
  neighborhoodSpread,
  stripGeometry,
  testChangeSentence,
  testCountLine,
  testPositionChange,
  timelineWindow,
  weekdayDayMon,
} from "./view";

const summary = (over: Partial<MonitorSummary> = {}): MonitorSummary => ({
  monitor_id: "m",
  status: "active",
  target_kind: "own",
  kitchen_id: null,
  store_name: "Loja",
  store_area: null,
  every_days: 7,
  effective_every_days: 7,
  next_run_at: null,
  latest: { xray_id: "x1", status: "ready", created_at: "2026-11-02T10:00:00-03:00", quorum: { finished: 31, total: 31, required: 28 } },
  last_ready: { xray_id: "x1", created_at: "2026-11-02T10:00:00-03:00", on: "2026-11-02", rank: 4, stores_ranked: 31, previous_rank: 6, doubts_open: 0 },
  extraction_on: true,
  ...over,
});

const item = (over: Partial<ResultItem>): ResultItem => ({
  item_id: "i",
  name: "Item",
  own_cents: 1000,
  parity_cents: 1000,
  gap_pct: 0,
  reading: "na_media",
  loss_cents: null,
  parity_full_cents: null,
  gap_full_pct: null,
  full_price_room: false,
  pareto_rank: null,
  pareto_cum_share: null,
  low_cents: 800,
  high_cents: 1200,
  stores: 5,
  category: "lanches",
  group: "lanches",
  ...over,
});

describe("B01 P19 list words", () => {
  it("B01_P19_dates_and_periods_in_sao_paulo", () => {
    expect(dayMon("2026-11-02")).toBe("02/nov");
    expect(weekdayDayMon("2026-11-02")).toBe("seg 02/nov");
    expect(weekdayDayMon("2026-11-10T01:30:00Z")).toBe("seg 09/nov");
    expect(periodLabel(7)).toBe("toda semana");
    expect(periodLabel(14)).toBe("a cada 2 semanas");
    expect(periodLabel(28)).toBe("todo mês");
    expect(periodLabel(90)).toBe("a cada 3 meses");
  });

  it("B01_P19_status_pill_reading_doubts_paused_and_up_to_date", () => {
    expect(monitorPill(summary())).toEqual({ kind: "ok", text: "em dia", to: null });
    expect(monitorPill(summary({ last_ready: { ...summary().last_ready!, doubts_open: 9 } }))).toEqual({ kind: "doubts", text: "espera você: 9 itens", to: "revisar" });
    const reading = summary({ latest: { xray_id: "x2", status: "collecting", created_at: "", quorum: { finished: 23, total: 31, required: 28 } } });
    expect(monitorPill(reading)).toEqual({ kind: "reading", text: "lendo 23 de 31", to: "lendo" });
    expect(monitorPill(summary({ status: "paused_by_person" })).text).toBe("pausado por você");
    expect(monitorPill(summary({ status: "paused_by_plan" })).text).toBe("pausado pelo plano");
    expect(monitorPill(summary({ extraction_on: false })).text).toBe("leitura automática desligada");
  });

  it("B01_M1_10_rank_delta_and_M1_12_score_delta", () => {
    expect(rankDelta(4, 6)).toBe("subiu 2");
    expect(rankDelta(7, 6)).toBe("caiu 1");
    expect(rankDelta(4, 4)).toBe("igual");
    expect(rankDelta(4, null)).toBeNull();
    expect(scoreDelta(1)).toBe("+1");
    expect(scoreDelta(-1)).toBe("−1");
    expect(scoreDelta(0)).toBe("igual");
  });

  it("B01_P19_plan_line_mirrors_monitor_limits", () => {
    const parts = planLine({ plan: "lucro", own_active: 3, competitor_active: 2, competitor_max: 3, competitor_started_month: 1, count_month_starts: true, competitor_allowed: true });
    expect(parts.map((p) => `${p.label} ${p.value}`)).toEqual(["Plano Lucro", "Suas lojas: 3", "Concorrentes ativos: 2 de 3", "Novos este mês: 1 de 3"]);
    expect(planLine({ plan: "raio_x", own_active: 1, competitor_active: 0, competitor_max: 0, competitor_started_month: 0, count_month_starts: true, competitor_allowed: false })).toHaveLength(2);
  });
});

describe("B01 P21 waiting screen", () => {
  const counts = { done: 22, running: 3, queued: 2, retry_wait: 2, failed: 1, beyond_cap: 54, total: 30 };

  it("B01_P21_steps_done_now_next_with_the_runs_numbers", () => {
    const s = stepTexts({ step: "capture", stores_found: 107, stores_chosen: 30, quorum: { finished: 23, total: 31, required: 28 }, counts, radiusKm: 3 });
    expect(s.map((x) => x.state)).toEqual(["done", "now", "next", "next"]);
    expect(s[0].sub).toBe("107 lojas encontradas. Lemos as 30 mais relevantes.");
    expect(s[1].sub).toBe("22 de 30 lidos");
    expect(s[2].sub).toBe("Começa quando 28 de 31 cardápios estiverem lidos.");
  });

  it("B01_P21_bar_leaves_beyond_cap_out_of_the_denominator", () => {
    const seg = progressSegments(counts);
    expect(seg.map((x) => x.state)).toEqual(["done", "running", "retry_wait", "queued", "failed"]);
    expect(seg[0].pct).toBeCloseTo(73.3);
    expect(seg.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(100, 0);
  });

  it("B01_P21_why_it_takes_time_uses_real_numbers", () => {
    expect(readSoFar(27, 1684)).toBe("Até agora: 27 cardápios, 1.684 itens.");
  });
});

describe("B01 P22 and P23 lists by category", () => {
  it("B01_items_grouped_by_category_in_screen_order", () => {
    const g = byGroup([{ group: "porcoes" as const, n: 1 }, { group: "bebidas" as const, n: 2 }, { group: "porcoes" as const, n: 3 }]);
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([["Bebidas", 1], ["Porções", 2]]);
  });

  it("B01_M1_07_reading_groups_order_and_sorting", () => {
    const groups = readingGroups([
      item({ name: "A", reading: "nao_mexer", gap_pct: 0.12 }),
      item({ name: "B", reading: "pode_subir", own_cents: 1490, parity_cents: 1840 }),
      item({ name: "C", reading: "pode_subir", own_cents: 1290, parity_cents: 1590 }),
      item({ name: "D", reading: "nao_mexer", gap_pct: 0.17 }),
      item({ name: "E", reading: "na_media" }),
    ]);
    expect(groups.map((g) => [g.reading, g.items.map((i) => i.name).join("")])).toEqual([
      ["pode_subir", "BC"],
      ["na_media", "E"],
      ["nao_mexer", "DA"],
    ]);
  });
});

describe("B01 P23 result words, never money", () => {
  it("B01_M1_06_gap_in_words", () => {
    expect(gapWords(-0.19)).toBe("19% abaixo do meio");
    expect(gapWords(0.004)).toBe("no meio");
    expect(gapWords(0.17)).toBe("17% acima do meio");
  });

  it("B01_M1_09_headline_is_price_gap_per_sale", () => {
    const h = headline([item({ own_cents: 1490, parity_cents: 1840 }), item({ own_cents: 1290, parity_cents: 1590 }), item({ own_cents: 1690, parity_cents: 1990 })]);
    expect(h).toEqual({ count: 3, max: 350, sum: 950 });
  });

  it("B01_M1_10_position_in_words_and_change", () => {
    expect(positionWords(4, 31, "você")).toEqual({ lead: "Você cobra menos que 27 das 30 lojas vizinhas", tail: "Só 3 cobram menos que você." });
    expect(positionWords(2, 31, "O Concorrente A").tail).toBe("Só 1 cobra menos que ele.");
    expect(positionWords(1, 5, "você").tail).toBe("Nenhuma cobra menos que você.");
    expect(positionChange({ rank: 4, stores_ranked: 31 }, { rank: 6, stores_ranked: 31 }, "2026-10-26", 7)).toBe("Na semana passada (26/out), 25 cobravam mais. Agora são 2 a mais.");
    expect(positionChange({ rank: 4, stores_ranked: 31 }, { rank: 4, stores_ranked: 31 }, "2026-10-26", 7)).toBe("Igual à semana passada.");
    expect(positionChange({ rank: 4, stores_ranked: 31 }, null, null, 7)).toBeNull();
  });

  it("B01_M1_05_strip_keeps_own_price_on_the_track", () => {
    const g = stripGeometry({ own_cents: 2500, parity_cents: 2000, low_cents: 1500, high_cents: 2400 });
    expect(g.own).toBeCloseTo(97);
    expect(g.range.left).toBeCloseTo(3);
    expect(g.ownAlign).toBe("r");
  });

  it("B01_P23_strip_ends_are_the_scale_so_an_own_price_outside_the_neighbors_reads_right", () => {
    const g = stripGeometry({ own_cents: 4800, parity_cents: 3345, low_cents: 2380, high_cents: 3790 });
    expect([g.lo, g.hi]).toEqual([2380, 4800]);
    expect([g.neighborsLo, g.neighborsHi]).toEqual([2380, 3790]);
    expect(g.own).toBeCloseTo(97);
  });

  it("B01_P23_strip_with_one_neighbor_still_shows_its_price", () => {
    const g = stripGeometry({ own_cents: 3600, parity_cents: 3700, low_cents: 3700, high_cents: 3700 });
    expect(g.range.width).toBeGreaterThanOrEqual(2);
  });

  const neighbors = [2690, 2800, 3000, 3100, 3300, 3500, 3700, 3900];

  it("B01_P23_spread_ranks_the_store_among_the_neighbors_and_itself", () => {
    const s = neighborhoodSpread(neighbors, 2990, 3250, "Você");
    expect(s.sentence).toBe("Você é o 3º mais barato entre 9 lojas.");
    expect(s.total).toBe(9);
    expect([s.lo, s.hi]).toEqual([2690, 3900]);
  });

  it("B01_P23_spread_says_cheapest_and_priciest_without_a_number", () => {
    expect(neighborhoodSpread(neighbors, 2000, 3250, "Ele").sentence).toBe("Ele é o mais barato entre 9 lojas.");
    expect(neighborhoodSpread(neighbors, 4000, 3250, "Você").sentence).toBe("Você é o mais caro entre 9 lojas.");
  });

  it("B01_P23_spread_zones_split_every_neighbor_below_the_middle", () => {
    const z = neighborhoodSpread(neighbors, 2990, 3250, "Você").zones;
    expect(z).toEqual([
      { label: "Mais baratas", count: 2 },
      { label: "Até o meio", count: 2 },
      { label: "Acima do meio", count: 4 },
    ]);
  });

  it("B01_P23_spread_zones_split_every_neighbor_above_the_middle", () => {
    const z = neighborhoodSpread(neighbors, 3600, 3250, "Você").zones;
    expect(z).toEqual([
      { label: "Abaixo do meio", count: 4 },
      { label: "Até você", count: 2 },
      { label: "Mais caras", count: 2 },
    ]);
    expect(z.reduce((n, x) => n + x.count, 0)).toBe(neighbors.length);
  });

  it("B01_P23_spread_stacks_equal_prices_and_marks_only_the_own_dot", () => {
    const s = neighborhoodSpread([3000, 3000, 3000, 4000], 3000, 3000, "Você");
    expect(s.dots.filter((d) => d.me)).toHaveLength(1);
    expect(s.dots.map((d) => d.level).sort()).toEqual([0, 0, 1, 2, 3]);
    expect(s.levels).toBe(4);
    expect(Object.keys(s.dots[0]).sort()).toEqual(["left", "level", "me"]);
  });

  it("B01_P23_spread_all_equal_prices_stay_on_the_track", () => {
    const s = neighborhoodSpread([3000], 3000, 3000, "Você");
    expect(s.dots.every((d) => d.left >= 3 && d.left <= 97)).toBe(true);
  });
});

describe("B01 P24 history", () => {
  it("B01_P24_changes_since_the_previous_run", () => {
    expect(rankChangeSince(4, 6, "2026-10-26")).toBe("2 posições mais barata desde 26/out");
    expect(rankChangeSince(5, 4, "2026-10-26")).toBe("1 posição mais cara desde 26/out");
    expect(scoreChangeSince(1, "2026-10-26")).toBe("+1 desde 26/out");
    expect(scoreChangeSince(0, "2026-10-26")).toBe("igual a 26/out");
  });

  it("B01_P24_a_missing_run_breaks_the_line", () => {
    const p = linePaths([1, 2, null, 4], { width: 100, height: 50, left: 0, right: 0, top: 0, bottom: 0, lo: 0, hi: 4 });
    expect(p.segments).toHaveLength(2);
  });
});

describe("B01 P23 continuity: timeline, tests and next steps", () => {
  const run = (id: string, on: string, over: Partial<History["runs"][number]> = {}): History["runs"][number] => ({
    xray_id: id,
    created_at: `${on}T10:00:00-03:00`,
    on,
    status: "ready",
    stores_read: 9,
    items_compared: 20,
    rank: 4,
    stores_ranked: 9,
    price_index: 1,
    score: 60,
    score_version: "v3",
    delta: null,
    delta_items: null,
    by_category: [],
    ...over,
  });
  const runs = [run("a", "2026-10-26"), run("b", "2026-11-02", { status: "collecting", on: null }), run("c", "2026-11-02"), run("d", "2026-11-09")];

  it("B01_P23_run_number_counts_only_calculated_runs", () => {
    expect(runNumber(runs, "a")).toBe(1);
    expect(runNumber(runs, "c")).toBe(2);
    expect(runNumber(runs, "d")).toBe(3);
    expect(runNumber(runs, "b")).toBeNull();
    expect(runLabel(runs, "d")).toBe("Raio-X 3 desta loja");
  });

  it("B01_P23_next_run_words", () => {
    expect(nextRunText("2026-11-16T09:00:00-03:00", "active")).toBe("Próximo em seg 16/nov");
    expect(nextRunText("2026-11-16T09:00:00-03:00", "paused_by_person")).toBe("Acompanhamento pausado");
    expect(nextRunText(null, "paused_by_plan")).toBe("Acompanhamento pausado");
    expect(nextRunText(null, "removed")).toBe("Acompanhamento encerrado");
    expect(nextRunText(null, "active")).toBeNull();
  });

  it("B01_P23_timeline_window_of_8_with_this_run_highlighted_and_the_next_dotted", () => {
    const many = Array.from({ length: 10 }, (_, i) => run(`r${i}`, `2026-09-${String(i + 1).padStart(2, "0")}`, { score: 50 + i, rank: 10 - i }));
    const w = timelineWindow(many, "r9", { nextRunAt: "2026-09-17T10:00:00-03:00", status: "active" });
    expect(w.points.map((p) => p.xray_id)).toEqual(["r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]);
    expect(w.points.filter((p) => p.current).map((p) => p.xray_id)).toEqual(["r9"]);
    expect(w.next).toEqual({ label: "17/set" });
    const old = timelineWindow(many, "r0", { nextRunAt: "2026-09-17T10:00:00-03:00", status: "active" });
    expect(old.points.map((p) => p.xray_id)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
    expect(old.next).toBeNull();
    const paused = timelineWindow(many, "r9", { nextRunAt: "2026-09-17T10:00:00-03:00", status: "paused_by_person" });
    expect(paused.next).toBeNull();
  });

  it("B01_P23_timeline_with_a_single_run_keeps_the_point_and_the_next", () => {
    const w = timelineWindow([run("a", "2026-11-09")], "a", { nextRunAt: "2026-11-16T09:00:00-03:00", status: "active" });
    expect(w.points).toHaveLength(1);
    expect(w.points[0]).toMatchObject({ current: true, score: 60, rank: 4, stores_ranked: 9, label: "09/nov" });
    expect(w.next?.label).toBe("16/nov");
    expect(w.single).toBe(true);
  });

  const point = (over: Partial<TestPoint> = {}): TestPoint => ({
    xray_id: "x1",
    on: "2026-11-02",
    item_id: "i1",
    own_cents: 2000,
    parity_cents: 2500,
    gap_pct: -0.2,
    reading: "pode_subir",
    rank: 5,
    stores: 9,
    ...over,
  });
  const test = (over: Partial<TestItem> = {}): TestItem => ({
    test_id: "t",
    own_item_id: "o",
    name: "X-Burger",
    marked_at: "2026-11-02T15:00:00-03:00",
    marked_on: "2026-11-02",
    marked_by: "Pessoa",
    from_xray_id: "x1",
    same_run: false,
    then: point(),
    now: point({ xray_id: "x2", on: "2026-11-09", own_cents: 2400, parity_cents: 2450, gap_pct: -0.02, reading: "na_media", rank: 3 }),
    ...over,
  });

  it("B01_P23_test_change_sentence", () => {
    expect(testChangeSentence(test())).toBe("Marcado em 02/nov: você R$ 20,00, meio R$ 25,00. Agora: você R$ 24,00, meio R$ 24,50, na média.");
    expect(testChangeSentence(test({ same_run: true, now: point() }))).toBe("Marcado em 02/nov: você R$ 20,00, meio R$ 25,00. O próximo raio-X mostra o que mudou.");
    expect(testChangeSentence(test({ now: null }))).toBe("Marcado em 02/nov: você R$ 20,00, meio R$ 25,00. Agora: o item não apareceu neste raio-X.");
    expect(testChangeSentence(test({ now: point({ reading: "nao_mexer", own_cents: 3000 }) }))).toBe(
      "Marcado em 02/nov: você R$ 20,00, meio R$ 25,00. Agora: você R$ 30,00, meio R$ 25,00, não mexa sem saber o custo.",
    );
    expect(testChangeSentence(test({ then: point({ parity_cents: null, reading: null }) }))).toBe("Marcado em 02/nov: você R$ 20,00. Agora: você R$ 24,00, meio R$ 24,50, na média.");
  });

  it("B01_P23_test_position_change_M1_10", () => {
    expect(testPositionChange(test())).toBe("Entre as lojas que vendem: era 5ª de 9, agora 3ª de 9.");
    expect(testPositionChange(test({ same_run: true }))).toBeNull();
    expect(testPositionChange(test({ now: point({ rank: null }) }))).toBeNull();
  });

  it("B01_P23_next_steps_test_line", () => {
    expect(testCountLine(0, 3)).toBe("Nenhum item em teste.");
    expect(testCountLine(1, 3)).toBe("1 de 3 itens em teste.");
    expect(testCountLine(3, 3)).toBe("3 de 3 itens em teste.");
  });
});

describe("P23 radius map", () => {
  it("B01_P23_map_dots_scale_to_the_radius_north_up_and_stay_inside", () => {
    const dots = mapDots({ radius_km: 3, stores: [{ x_km: 1.5, y_km: 0 }, { x_km: 0, y_km: 3 }, { x_km: 0, y_km: -6 }] }, 90);
    expect(dots[0]).toEqual({ x: 45, y: -0 });
    expect(dots[1]).toEqual({ x: 0, y: -90 });
    expect(dots[2]).toEqual({ x: 0, y: 90 });
  });
});
