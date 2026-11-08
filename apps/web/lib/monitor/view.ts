// M1 owner journey screens (P19 to P24, W10 to W15), pure parts: words and numbers as the prototype draws them
// (scratchpad m1-owner-journey.html, pending drawings in design/). No I/O; unit-tested in view.test.ts. Every number
// traces to a rule of spec/04-rules.md, named in the function's docstring. Never money words: a price gap is
// "diferença de preço por venda", never profit (Marlon, M1-12 decision row).
import { money } from "@/lib/xray/format";
import { GROUP_LABEL, type Group } from "./rules";
import type { CaptureState, History, MonitorStatus, MonitorSummary, Progress, Result, ResultItem, TestItem } from "./load";

const TZ = "America/Sao_Paulo";
const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const brl = money;

/** "2026-11-02" (a São Paulo calendar day from SQL) or an instant, as a São Paulo day. */
function spParts(d: string | Date): { y: number; m: number; d: number } {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return { y, m, d: day };
  }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(d));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** "02/nov". */
export function dayMon(d: string | Date): string {
  const p = spParts(d);
  return `${String(p.d).padStart(2, "0")}/${MON[p.m - 1]}`;
}

/** "seg 02/nov". */
export function weekdayDayMon(d: string | Date): string {
  const p = spParts(d);
  return `${WEEKDAY[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]} ${dayMon(d)}`;
}

/** "segunda, 02/nov" (P23 lead). */
export function longWeekdayDayMon(d: string | Date): string {
  const p = spParts(d);
  const names = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  return `${names[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]}, ${dayMon(d)}`;
}

/** "14:40" in São Paulo. */
export function hourMin(d: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
}

/** P19 period of a monitoring: "toda semana", "a cada 2 semanas", "todo mês", "a cada 3 meses". */
export function periodLabel(days: number): string {
  if (days === 7) return "toda semana";
  if (days === 14) return "a cada 2 semanas";
  if (days === 28 || days === 30) return "todo mês";
  if (days === 90) return "a cada 3 meses";
  return `a cada ${days} dias`;
}

// P19 / W10 ---------------------------------------------------------------------------------------------------------------

export type PillKind = "ok" | "reading" | "doubts" | "paused" | "plan" | "off" | "waiting";

/** P19 status pill of a row (draft §2.3): reading, waiting for the owner's answers, paused, up to date. */
export function monitorPill(m: MonitorSummary): { kind: PillKind; text: string; to: "lendo" | "revisar" | null } {
  if (m.status === "paused_by_person") return { kind: "paused", text: "pausado por você", to: null };
  if (m.status === "paused_by_plan") return { kind: "plan", text: "pausado pelo plano", to: null };
  if (!m.extraction_on) return { kind: "off", text: "leitura automática desligada", to: null };
  const reading = m.latest && !["ready", "delivered", "failed"].includes(m.latest.status) && m.latest.xray_id !== m.last_ready?.xray_id;
  if (reading) {
    const q = m.latest!.quorum;
    return { kind: "reading", text: q.total ? `lendo ${q.finished} de ${q.total}` : "buscando a vizinhança", to: "lendo" };
  }
  const open = m.last_ready?.doubts_open ?? 0;
  if (open > 0) return { kind: "doubts", text: `espera você: ${open} ${open === 1 ? "item" : "itens"}`, to: "revisar" };
  if (!m.last_ready) return { kind: "waiting", text: "primeiro raio-X a caminho", to: "lendo" };
  return { kind: "ok", text: "em dia", to: null };
}

/** M1-10 position words: "4ª". */
export const ordinal = (n: number) => `${n}ª`;

/** M1-10 change of the store's rank since the previous run (1 = cheapest): "subiu 2", "caiu 1", "igual". */
export function rankDelta(rank: number | null, previous: number | null): string | null {
  if (rank === null || previous === null) return null;
  if (rank === previous) return "igual";
  return rank < previous ? `subiu ${previous - rank}` : `caiu ${rank - previous}`;
}

/** M1-12 change of the score since the previous run, signed with U+2212: "+1", "−1", "igual". */
export function scoreDelta(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return "igual";
  return delta > 0 ? `+${delta}` : `−${-delta}`;
}

/** P19 plan line counts, as the server checks them (monitor_limits; draft §3.3). */
export function planLine(l: { plan: string; own_active: number; competitor_active: number; competitor_max: number; competitor_started_month: number; count_month_starts: boolean; competitor_allowed: boolean }) {
  const name = { raio_x: "Raio-X", lucro: "Lucro", rede: "Rede" }[l.plan] ?? l.plan;
  const parts: { label: string; value: string }[] = [
    { label: "Plano", value: name },
    { label: "Suas lojas:", value: String(l.own_active) },
  ];
  if (l.competitor_allowed) {
    parts.push({ label: "Concorrentes ativos:", value: `${l.competitor_active} de ${l.competitor_max}` });
    if (l.count_month_starts) parts.push({ label: "Novos este mês:", value: `${l.competitor_started_month} de ${l.competitor_max}` });
  }
  return parts;
}

// P21 / W12 ---------------------------------------------------------------------------------------------------------------

export type StepKey = "discover" | "capture" | "pair" | "calc";
const STEP_ORDER: StepKey[] = ["discover", "capture", "pair", "calc"];

/** Step number 1 to 4 of the waiting screen, 5 when ready. */
export function stepIndex(step: Progress["step"]): number {
  return step === "ready" ? 5 : STEP_ORDER.indexOf(step) + 1;
}

/**
 * P21 steps (draft §2.5): done with its result, current with live counts, or next. B01 quorum: pairing starts at
 * m1.pair_min_captures_pct of the capture slots (quorum.required of quorum.total).
 */
export function stepTexts(p: Pick<Progress, "step" | "stores_found" | "stores_chosen" | "quorum" | "counts"> & { radiusKm: number }): { title: string; sub: string; state: "done" | "now" | "next" }[] {
  const now = stepIndex(p.step);
  const total = p.counts.total;
  const done = p.counts.done;
  const subs = [
    now > 1 ? `${p.stores_found} lojas encontradas. Lemos as ${p.stores_chosen} mais relevantes.` : `Procurando as lojas num raio de ${p.radiusKm} km.`,
    now > 2 ? `${done} de ${total} lidos. Já dá para comparar.` : now === 2 ? `${done} de ${total} lidos` : "Depois da vizinhança.",
    now === 3 ? "Conferindo produto, tamanho e sabor." : now > 3 ? "Itens conferidos." : `Começa quando ${p.quorum.required} de ${p.quorum.total || total} cardápios estiverem lidos.`,
    "Preço da vizinhança e o que tem espaço para subir.",
  ];
  const titles = ["Buscar a vizinhança", "Ler os cardápios", "Comparar os itens", "Calcular"];
  return titles.map((title, i) => ({ title, sub: subs[i], state: i + 1 < now ? "done" : i + 1 === now ? "now" : "next" }));
}

/** P21 segmented bar: shares of the capture slots (beyond_cap is not in the denominator, M1-11). */
export function progressSegments(c: Record<CaptureState | "total", number>): { state: Exclude<CaptureState, "beyond_cap">; pct: number }[] {
  const order: Exclude<CaptureState, "beyond_cap">[] = ["done", "running", "retry_wait", "queued", "failed"];
  const total = Math.max(c.total, 1);
  return order.map((state) => ({ state, pct: Math.round((c[state] / total) * 1000) / 10 }));
}

/** "Até agora: 27 cardápios, 1.684 itens." */
export function readSoFar(menus: number, items: number): string {
  return `Até agora: ${menus} ${menus === 1 ? "cardápio" : "cardápios"}, ${items.toLocaleString("pt-BR")} itens.`;
}

// P22 / W13 ---------------------------------------------------------------------------------------------------------------

/** Groups rows by their screen group in GROUPS order (Marlon, 07/nov: every item list by category). */
export function byGroup<T extends { group: Group }>(rows: T[]): { group: Group; label: string; rows: T[] }[] {
  const order = Object.keys(GROUP_LABEL) as Group[];
  return order.map((group) => ({ group, label: GROUP_LABEL[group], rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length);
}

/** "1 item selecionado", "3 itens selecionados". */
export const selectedLabel = (n: number) => `${n} ${n === 1 ? "item selecionado" : "itens selecionados"}`;

// P23 / W14 ---------------------------------------------------------------------------------------------------------------

/** M1-06 gap in words: "23% abaixo do meio", "no meio", "12% acima do meio". */
export function gapWords(gap: number): string {
  const a = Math.round(Math.abs(gap) * 100);
  return a === 0 ? "no meio" : `${a}% ${gap < 0 ? "abaixo" : "acima"} do meio`;
}

export type ReadingKey = ResultItem["reading"];

/** M1-07 reading groups of the result, inside each category, in this order. */
export const READING_ORDER: ReadingKey[] = ["pode_subir", "na_media", "nao_mexer"];

/** M1-05 parity minus own price, the "diferença de preço por venda" of an item below the middle. Never negative. */
export const priceGapPerSale = (i: Pick<ResultItem, "parity_cents" | "own_cents">) => Math.max(0, i.parity_cents - i.own_cents);

/** M1-07 items of one category, grouped by reading; "pode subir" by the largest gap per sale first, "não mexa" most above first. */
export function readingGroups(items: ResultItem[]): { reading: ReadingKey; items: ResultItem[] }[] {
  return READING_ORDER.map((reading) => {
    const list = items.filter((i) => i.reading === reading);
    list.sort((a, b) =>
      reading === "pode_subir"
        ? priceGapPerSale(b) - priceGapPerSale(a) || a.name.localeCompare(b.name, "pt-BR")
        : reading === "nao_mexer"
          ? b.gap_pct - a.gap_pct || a.name.localeCompare(b.name, "pt-BR")
          : a.name.localeCompare(b.name, "pt-BR"),
    );
    return { reading, items: list };
  }).filter((g) => g.items.length);
}

/** M1-09 headline: the top items to raise, the largest gap per sale among them and the sum of one sale of each. */
export function headline(top: ResultItem[]): { count: number; max: number; sum: number } {
  const gaps = top.map(priceGapPerSale);
  return { count: top.length, max: Math.max(0, ...gaps), sum: gaps.reduce((a, b) => a + b, 0) };
}

/** M1-10 position in words (P23): "Você cobra menos que 27 das 30 lojas vizinhas" and who charges less. */
export function positionWords(rank: number, storesRanked: number, who: "você" | string): { lead: string; tail: string } {
  const others = storesRanked - 1;
  const more = storesRanked - rank;
  const cheaper = rank - 1;
  const subject = who === "você" ? "Você cobra" : `${who} cobra`;
  const obj = who === "você" ? "você" : "ele";
  return {
    lead: `${subject} menos que ${more} das ${others} lojas vizinhas`,
    tail: cheaper === 0 ? `Nenhuma cobra menos que ${obj}.` : `Só ${cheaper} ${cheaper === 1 ? "cobra" : "cobram"} menos que ${obj}.`,
  };
}

/** M1-10 change since the previous run, as "Na semana passada (26/out), 25 cobravam mais. Agora são 2 a mais." */
export function positionChange(now: { rank: number; stores_ranked: number }, prev: { rank: number; stores_ranked: number } | null, prevOn: string | null, everyDays: number): string | null {
  if (!prev || !prevOn) return null;
  const moreNow = now.stores_ranked - now.rank;
  const morePrev = prev.stores_ranked - prev.rank;
  const when = everyDays === 7 ? `Na semana passada (${dayMon(prevOn)})` : `No raio-X anterior (${dayMon(prevOn)})`;
  if (moreNow === morePrev) return everyDays === 7 ? "Igual à semana passada." : "Igual ao raio-X anterior.";
  const d = moreNow - morePrev;
  return `${when}, ${morePrev} cobravam mais. Agora são ${Math.abs(d)} a ${d > 0 ? "mais" : "menos"}.`;
}

/** M1-08 Pareto sentence: "4 de 41 itens concentram 80% da diferença de preço abaixo do meio." */
export function paretoSentence(count: number, compared: number): string | null {
  return count > 0 ? `${count} de ${compared} itens concentram 80% da diferença de preço abaixo do meio.` : null;
}

/**
 * P23 radius map: the dots of the run's compared stores in an SVG whose circle of radius `radiusPx` is the run's
 * radius. North is up (SVG y grows down). A store just past the radius (distance is measured by the collector, the
 * offsets here by latitude and longitude) is drawn on the edge, never outside the circle.
 */
export function mapDots(map: { radius_km: number; stores: { x_km: number; y_km: number }[] }, radiusPx: number) {
  const scale = map.radius_km > 0 ? radiusPx / map.radius_km : 0;
  return map.stores.map((s) => {
    const x = s.x_km * scale;
    const y = -s.y_km * scale;
    const d = Math.hypot(x, y);
    const k = d > radiusPx ? radiusPx / d : 1;
    return { x: Math.round(x * k * 10) / 10, y: Math.round(y * k * 10) / 10 };
  });
}

/** M1-05 strip geometry: positions in percent of the lowest, highest, middle and own price on one track. */
export function stripGeometry(i: Pick<ResultItem, "own_cents" | "parity_cents" | "low_cents" | "high_cents">) {
  const lo = Math.min(i.low_cents ?? i.parity_cents, i.own_cents, i.parity_cents);
  const hi = Math.max(i.high_cents ?? i.parity_cents, i.own_cents, i.parity_cents);
  const x = (v: number) => 3 + ((v - lo) / (hi - lo || 1)) * 94;
  const align = (v: number) => (v < 30 ? "l" : v > 70 ? "r" : "c");
  const low = i.low_cents ?? lo;
  const high = i.high_cents ?? hi;
  // The neighbors' range keeps a visible width with a single neighbor (low = high).
  const width = Math.max(x(high) - x(low), 2);
  return {
    /** Ends of the track: the scale, own price included (an own price outside the neighbors sits at an end). */
    lo,
    hi,
    /** The neighbors' range, for the accessible label. */
    neighborsLo: low,
    neighborsHi: high,
    range: { left: Math.min(x(low), 100 - width), width },
    med: x(i.parity_cents),
    own: x(i.own_cents),
    ownAlign: align(x(i.own_cents)),
    medAlign: align(x(i.parity_cents)),
  };
}

/** Dots closer than this share of the track sit on top of each other instead of overlapping. */
const SPREAD_STACK_GAP = 3;

/** "Ver os preços da vizinhança" (D80): where the store sits among the neighbors' prices (M1-05 middle, M1-10 position),
 *  with no store identified. Dots carry a position only, and the three zones always add up to the neighbors. */
export function neighborhoodSpread(prices: number[], own: number, parity: number, who: string) {
  const lo = Math.min(...prices, own, parity);
  const hi = Math.max(...prices, own, parity);
  const x = (v: number) => 3 + ((v - lo) / (hi - lo || 1)) * 94;
  const align = (v: number) => (v < 30 ? "l" : v > 70 ? "r" : "c");

  const points = [...prices.map((p) => ({ p, me: false })), { p: own, me: true }].sort((a, b) => a.p - b.p);
  let anchor = -Infinity;
  let level = 0;
  const dots = points.map((d) => {
    const left = x(d.p);
    if (left - anchor < SPREAD_STACK_GAP) level += 1;
    else {
      anchor = left;
      level = 0;
    }
    return { left, level, me: d.me };
  });

  const label = `${who[0].toUpperCase()}${who.slice(1)}`;
  const total = prices.length + 1;
  const cheaper = prices.filter((p) => p < own).length;
  const pricier = prices.filter((p) => p > own).length;
  const where = cheaper === 0 ? "o mais barato" : pricier === 0 ? "o mais caro" : `o ${cheaper + 1}º mais barato`;
  const count = (test: (p: number) => boolean) => prices.filter(test).length;
  const zones =
    own <= parity
      ? [
          { label: "Mais baratas", count: count((p) => p < own) },
          { label: "Até o meio", count: count((p) => p >= own && p <= parity) },
          { label: "Acima do meio", count: count((p) => p > parity) },
        ]
      : [
          { label: "Abaixo do meio", count: count((p) => p < parity) },
          { label: `Até ${who.toLowerCase()}`, count: count((p) => p >= parity && p <= own) },
          { label: "Mais caras", count: count((p) => p > own) },
        ];

  return {
    who: label,
    sentence: `${label} é ${where} entre ${total} lojas.`,
    total,
    lo,
    hi,
    dots,
    levels: Math.max(...dots.map((d) => d.level)) + 1,
    own: { left: x(own), align: align(x(own)) },
    med: { left: x(parity), align: align(x(parity)) },
    zones,
  };
}

/** P23 category summary (M1-07 counts, M1-05 sum of price gaps of pode_subir items). */
export function categorySummary(c: Result["by_category"][number]) {
  return { compared: c.items_compared, up: c.can_go_up, hold: c.leave_alone, gap: c.price_gap_per_sale_cents };
}

/** The category with the largest price gap per sale opens first (prototype). */
export function firstOpenGroup(cats: Result["by_category"]): Group | null {
  const best = [...cats].filter((c) => c.items_compared > 0).sort((a, b) => b.price_gap_per_sale_cents - a.price_gap_per_sale_cents)[0];
  return best?.group ?? null;
}

// P24 / W15 ---------------------------------------------------------------------------------------------------------------

/** M1-10 rank change in words: "2 posições mais barata desde 26/out", "igual a 26/out". */
export function rankChangeSince(now: number | null, prev: number | null, prevOn: string | null): string | null {
  if (now === null || prev === null || !prevOn) return null;
  const d = prev - now;
  if (d === 0) return `igual a ${dayMon(prevOn)}`;
  const n = Math.abs(d);
  return `${n} ${n === 1 ? "posição" : "posições"} mais ${d > 0 ? "barata" : "cara"} desde ${dayMon(prevOn)}`;
}

/** M1-12 change in words: "+1 desde 26/out", "igual a 26/out". */
export function scoreChangeSince(delta: number | null, prevOn: string | null): string | null {
  if (delta === null || !prevOn) return null;
  return delta === 0 ? `igual a ${dayMon(prevOn)}` : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} desde ${dayMon(prevOn)}`;
}

/** Line chart geometry for P24 (no interpolation across missing runs: a null breaks the line, draft §2.8). */
export function linePaths(values: (number | null)[], opts: { width: number; height: number; left: number; right: number; top: number; bottom: number; lo: number; hi: number; invert?: boolean }) {
  const n = values.length;
  const x = (i: number) => opts.left + (n === 1 ? (opts.width - opts.left - opts.right) / 2 : (i * (opts.width - opts.left - opts.right)) / (n - 1));
  const span = opts.hi - opts.lo || 1;
  const y = (v: number) =>
    opts.invert ? opts.top + ((v - opts.lo) / span) * (opts.height - opts.top - opts.bottom) : opts.height - opts.bottom - ((v - opts.lo) / span) * (opts.height - opts.top - opts.bottom);
  const segments: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
    } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(" "));
  return { segments, x, y };
}

// P23 continuity (Marlon, 08/nov): the run as one point of the monitoring, the items under test, the next run ----------

type HistoryRun = History["runs"][number];
const calculated = (runs: HistoryRun[]) => runs.filter((r) => (r.status === "ready" || r.status === "delivered") && r.on);

/** Index of the run among the monitoring's calculated runs, oldest = 1; null for a run not calculated. */
export function runNumber(runs: HistoryRun[], xrayId: string): number | null {
  const i = calculated(runs).findIndex((r) => r.xray_id === xrayId);
  return i < 0 ? null : i + 1;
}

/** "Raio-X 3 desta loja". */
export function runLabel(runs: HistoryRun[], xrayId: string): string | null {
  const n = runNumber(runs, xrayId);
  return n === null ? null : `Raio-X ${n} desta loja`;
}

/** "Próximo em seg 16/nov", "Acompanhamento pausado", "Acompanhamento encerrado"; null with no date yet. */
export function nextRunText(nextRunAt: string | null, status: MonitorStatus): string | null {
  if (status === "removed") return "Acompanhamento encerrado";
  if (status !== "active") return "Acompanhamento pausado";
  return nextRunAt ? `Próximo em ${weekdayDayMon(nextRunAt)}` : null;
}

export interface TimelinePoint {
  xray_id: string;
  label: string;
  /** M1-12 v3 "Itens alinhados", 0 to 100. */
  score: number | null;
  /** M1-10 position, 1 = cheapest. */
  rank: number | null;
  stores_ranked: number | null;
  current: boolean;
}

/**
 * P23 timeline: up to `max` calculated runs ending at the newest (or at the run shown, when it is older than that window),
 * the run shown marked current, and the next run as an empty point only when the window ends at the newest run and the
 * monitoring is active with a date. Numbers: M1-12 v3 score and M1-10 rank of each run, never interpolated.
 */
export function timelineWindow(runs: HistoryRun[], xrayId: string, o: { nextRunAt: string | null; status: MonitorStatus; max?: number }) {
  const max = o.max ?? 8;
  const all = calculated(runs);
  const at = all.findIndex((r) => r.xray_id === xrayId);
  const end = at < 0 || at >= all.length - max ? all.length : at + max;
  const win = all.slice(Math.max(0, end - max), end);
  const points: TimelinePoint[] = win.map((r) => ({
    xray_id: r.xray_id,
    label: dayMon(r.on!),
    score: r.score,
    rank: r.rank,
    stores_ranked: r.stores_ranked,
    current: r.xray_id === xrayId,
  }));
  const next = end === all.length && o.status === "active" && o.nextRunAt ? { label: dayMon(o.nextRunAt) } : null;
  return { points, next, single: all.length === 1 };
}

/** M1-07 reading in the owner's words, for "Seus testes". */
export function readingWords(reading: ResultItem["reading"]): string {
  return reading === "pode_subir" ? "com espaço para subir" : reading === "na_media" ? "na média" : "não mexa sem saber o custo";
}

const priceAndMiddle = (own: number | null, parity: number | null) =>
  [own !== null ? `você ${brl(own)}` : null, parity !== null ? `meio ${brl(parity)}` : null].filter(Boolean).join(", ");

/**
 * "Seus testes" line of one item: own price and M1-05 middle when it was marked, then on the run shown with its M1-07
 * reading. "Marcado em 02/nov: você R$ 20,00, meio R$ 25,00. Agora: você R$ 24,00, meio R$ 24,50, na média."
 */
export function testChangeSentence(t: TestItem): string {
  const then = t.then ? priceAndMiddle(t.then.own_cents, t.then.parity_cents) : "";
  const head = `Marcado em ${dayMon(t.marked_on)}${then ? `: ${then}` : ""}.`;
  if (t.same_run) return `${head} O próximo raio-X mostra o que mudou.`;
  if (!t.now) return `${head} Agora: o item não apareceu neste raio-X.`;
  const now = [priceAndMiddle(t.now.own_cents, t.now.parity_cents), t.now.reading ? readingWords(t.now.reading) : null].filter(Boolean).join(", ");
  return `${head} Agora: ${now || "sem comparação neste raio-X"}.`;
}

/** M1-10 position of the item among the stores selling it, then and now: "Entre as lojas que vendem: era 5ª de 9, agora 3ª de 9." */
export function testPositionChange(t: TestItem): string | null {
  if (t.same_run || !t.then || !t.now || t.then.rank === null || t.now.rank === null || t.then.stores === null || t.now.stores === null) return null;
  return `Entre as lojas que vendem: era ${ordinal(t.then.rank)} de ${t.then.stores}, agora ${ordinal(t.now.rank)} de ${t.now.stores}.`;
}

/** "Até o próximo raio-X" count of the test plan (m1.test_max_items). */
export function testCountLine(active: number, max: number): string {
  return active === 0 ? "Nenhum item em teste." : `${active} de ${max} itens em teste.`;
}
