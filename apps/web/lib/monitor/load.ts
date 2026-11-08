// M1 owner journey reads (P19 to P24). The monitoring and its runs are read through the member's scoped reader, so RLS
// decides who sees them (A02, A03: Gerente own kitchens only); only then the service-role loaders of migrations
// 20261230000001 and 20261230000002 fill in the detail, which joins console-only catalog tables. A monitoring or run
// the person cannot see is null (the page answers 404). No competitor price leaves monitor_partial (draft §2.5).
import type { ReadDb } from "@/lib/supabase/reader";
import type { Group, PaceInput } from "./rules";

export interface LoadDeps {
  /** Member.db: RLS as this person, filtered to the opened account. */
  db: ReadDb;
  /** Service-role RPC of the monitor_* loaders, called only after the RLS read above. */
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  env: "sandbox" | "production";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MonitorStatus = "active" | "paused_by_person" | "paused_by_plan" | "removed";

export interface MonitorRow {
  id: string;
  status: MonitorStatus;
  targetKind: "own" | "competitor";
  kitchenId: string | null;
  everyDays: number;
  radiusKm: number;
  nextRunAt: string | null;
  lastXrayId: string | null;
}

/** The monitoring as this person may see it, or null. */
export async function visibleMonitor(deps: LoadDeps, monitorId: string): Promise<MonitorRow | null> {
  if (!UUID.test(monitorId)) return null;
  const { data, error } = await deps.db
    .from("xray_monitor")
    .select("id, status, target_kind, kitchen_id, every_days, radius_km, next_run_at, last_xray_id")
    .eq("id", monitorId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    status: data.status,
    targetKind: data.target_kind === "own" ? "own" : "competitor",
    kitchenId: data.kitchen_id,
    everyDays: data.every_days,
    radiusKm: data.radius_km,
    nextRunAt: data.next_run_at,
    lastXrayId: data.last_xray_id,
  };
}

/** A run of a visible monitoring: the given one, or the newest; null when the run is not of this monitoring. */
export async function visibleRun(deps: LoadDeps, monitorId: string, xrayId?: string): Promise<{ monitor: MonitorRow; xrayId: string } | null> {
  const monitor = await visibleMonitor(deps, monitorId);
  if (!monitor) return null;
  const id = xrayId ?? monitor.lastXrayId;
  if (!id || !UUID.test(id)) return null;
  const { data, error } = await deps.db.from("xray").select("id").eq("id", id).eq("monitor_id", monitorId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { monitor, xrayId: data.id } : null;
}

/** The newest calculated run of a visible monitoring (P23 /app/raio-x/[monitor]). */
export async function latestReadyRun(deps: LoadDeps, monitorId: string): Promise<string | null> {
  if (!(await visibleMonitor(deps, monitorId))) return null;
  const { data, error } = await deps.db
    .from("xray")
    .select("id")
    .eq("monitor_id", monitorId)
    .in("status", ["ready", "delivered"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.id ?? null;
}

// P19 / W10 -----------------------------------------------------------------------------------------------------------

export interface MonitorSummary {
  monitor_id: string;
  status: MonitorStatus;
  target_kind: "own" | "competitor";
  kitchen_id: string | null;
  store_name: string | null;
  store_area: string | null;
  every_days: number;
  effective_every_days: number;
  next_run_at: string | null;
  latest: { xray_id: string; status: string; created_at: string; quorum: { finished: number; total: number; required: number } } | null;
  last_ready: { xray_id: string; created_at: string; on: string; rank: number | null; stores_ranked: number | null; previous_rank: number | null; doubts_open: number } | null;
  extraction_on: boolean;
}

export interface Limits {
  plan: string;
  competitor_allowed: boolean;
  competitor_max: number;
  competitor_active: number;
  competitor_started_month: number;
  count_month_starts: boolean;
  own_max: number | null;
  own_active: number;
  min_every_days: number;
  gerente_answers: boolean;
}

/** P19 list: the monitorings this person sees (RLS), removed ones only when asked, with status, progress and position. */
export async function loadMonitorList(deps: LoadDeps, accountId: string, opts: { includeRemoved?: boolean } = {}): Promise<{ monitors: MonitorSummary[]; limits: Limits }> {
  const { data, error } = await deps.db.from("xray_monitor").select("id, status");
  if (error) throw new Error(error.message);
  const ids = (data ?? []).filter((m) => opts.includeRemoved || m.status !== "removed").map((m) => m.id);
  const [monitors, limits] = await Promise.all([
    ids.length ? (deps.rpc("monitor_summaries", { p_monitors: ids }) as Promise<MonitorSummary[]>) : Promise.resolve([]),
    deps.rpc("monitor_limits", { p_account: accountId, p_env: deps.env }) as Promise<Limits>,
  ]);
  return { monitors, limits };
}

// P21 / W12 -----------------------------------------------------------------------------------------------------------

export type CaptureState = "done" | "running" | "queued" | "retry_wait" | "failed" | "beyond_cap";

export interface Progress {
  xray_id: string;
  monitor_id: string;
  status: string;
  step: "discover" | "capture" | "pair" | "calc" | "ready";
  created_at: string;
  counts: Record<CaptureState | "total", number>;
  quorum: { finished: number; total: number; required: number };
  blocker: "captures" | "neighborhood" | "target" | null;
  stores_found: number;
  stores_chosen: number;
  items_read: number;
  target: { state: CaptureState; retry_at: string | null } | null;
  stores: { public_store_id: string; name: string | null; is_target: boolean; state: CaptureState; retry_at: string | null; distance_m: number | null; items: number | null; left_out: boolean }[];
  pace: { finished_since_start: number; finished_in_window: number; last_finished_at: string | null; latest_retry_at: string | null; window_minutes: number; typical_seconds: number; slow_minutes: number; max_running: number };
  errors: { discover_failed: boolean; target_failed: boolean; extraction_off: boolean };
  now: string;
}

/** The P21 time range inputs (lib/monitor/rules.ts etaRange, isSlow) from a progress answer. */
export function paceInput(p: Progress): PaceInput {
  const d = (s: string | null) => (s ? new Date(s) : null);
  return {
    step: p.step,
    remaining: Math.max(p.quorum.required - p.quorum.finished, 0),
    running: p.counts.running,
    finishedSinceStart: p.pace.finished_since_start,
    finishedInWindow: p.pace.finished_in_window,
    windowMinutes: p.pace.window_minutes,
    typicalSeconds: p.pace.typical_seconds,
    maxRunning: p.pace.max_running,
    latestRetryAt: d(p.pace.latest_retry_at),
    lastFinishedAt: d(p.pace.last_finished_at),
    startedAt: new Date(p.created_at),
    slowMinutes: p.pace.slow_minutes,
    now: new Date(p.now),
  };
}

export async function loadProgress(deps: LoadDeps, monitorId: string, xrayId?: string): Promise<Progress | null> {
  const run = await visibleRun(deps, monitorId, xrayId);
  return run ? ((await deps.rpc("monitor_progress", { p_xray: run.xrayId })) as Progress) : null;
}

export interface Partial {
  stores_found: number;
  stores_read: { public_store_id: string; name: string | null; distance_m: number | null; items: number }[];
  own_items: { own_item_id: string; name: string; category: string | null; group: Group; stores: number }[];
  by_category: { group: Group; items: number; found_nearby: number }[];
}

/** P21 "enquanto isso", labeled "parcial, ainda sem comparação". */
export async function loadPartial(deps: LoadDeps, monitorId: string, xrayId?: string): Promise<Partial | null> {
  const run = await visibleRun(deps, monitorId, xrayId);
  return run ? ((await deps.rpc("monitor_partial", { p_xray: run.xrayId })) as Partial) : null;
}

// P22 / W13 -----------------------------------------------------------------------------------------------------------

export interface Candidate {
  pair_id: string;
  name: string;
  store: string | null;
  price_cents: number;
  unit: string;
  unit_qty: number | null;
  accepted: boolean;
  suggested: boolean;
}

export interface Doubt {
  item_id: string;
  own_item_id: string;
  name: string;
  own_cents: number;
  unit: string;
  unit_qty: number | null;
  pair_note: string | null;
  category: string | null;
  group: Group;
  answered: boolean;
  answered_at: string | null;
  answered_by: string | null;
  answered_by_staff: boolean;
  stores: number;
  candidates: Candidate[];
}

export interface Doubts {
  xray_id: string;
  /** False for a competitor run while m1.portal_competitor_doubts_asked is 0: listed as "Revisar mesmo assim". */
  asked: boolean;
  auto_confirmed: number;
  open: number;
  answered: number;
  only_yours: number;
  by_category: { group: Group; open: number; answered: number }[];
  items: Doubt[];
}

export async function loadDoubts(deps: LoadDeps, monitorId: string, xrayId?: string): Promise<Doubts | null> {
  const run = await visibleRun(deps, monitorId, xrayId);
  return run ? ((await deps.rpc("monitor_doubts", { p_xray: run.xrayId })) as Doubts) : null;
}

export interface ItemLists {
  by_category: { group: Group; only_yours: number; confirmed: number }[];
  only_yours: { item_id: string; name: string; own_cents: number; category: string | null; group: Group }[];
  confirmed: { item_id: string; name: string; own_cents: number; parity_cents: number | null; category: string | null; group: Group; by_system: boolean; accepted: { pair_id: string; name: string; store: string | null; price_cents: number }[] }[];
}

/** P22 collapsed sections "Itens só seus" and "Confirmados pelo sistema". */
export async function loadItemLists(deps: LoadDeps, monitorId: string, xrayId?: string): Promise<ItemLists | null> {
  const run = await visibleRun(deps, monitorId, xrayId);
  return run ? ((await deps.rpc("monitor_items", { p_xray: run.xrayId })) as ItemLists) : null;
}

// P23 / W14 -----------------------------------------------------------------------------------------------------------

export interface ResultItem {
  item_id: string;
  name: string;
  own_cents: number;
  parity_cents: number;
  gap_pct: number;
  reading: "pode_subir" | "na_media" | "nao_mexer";
  loss_cents: number | null;
  parity_full_cents: number | null;
  gap_full_pct: number | null;
  full_price_room: boolean;
  pareto_rank: number | null;
  pareto_cum_share: number | null;
  low_cents: number | null;
  high_cents: number | null;
  stores: number | null;
  category: string | null;
  group: Group;
}

/** M1-12 v3 "% de itens alinhados": share of the compared items in the neighborhood band (na_media). No cost, no volume: never money. */
export interface Score {
  /** 0 to 100; null for a category under m1.score_min_items items. */
  score: number | null;
  items: number;
  in_band: number;
  below: number;
  /** "risco": items read nao_mexer, never folded into the score. */
  risk: number;
  /** "diferença de preço por venda": sum of (parity minus own price) of the pode_subir items. */
  price_gap_per_sale_cents: number;
  version: string;
  /** Change since the previous run, over the delta_items scored in both; null without a previous run. */
  delta: number | null;
  delta_items: number | null;
}

/** Everything P01 shows, from the rule outputs P01 reads (test_b01_result_matches_p01_db), plus the portal extras. */
export interface Result {
  xray_id: string;
  monitor_id: string | null;
  status: string;
  target_kind: "own" | "competitor";
  store_name: string;
  synthetic: boolean;
  /** Cache key of a printed copy ("Baixar PDF"). */
  version: string;
  on: string;
  created_at: string;
  radius_km: number;
  reading_band: number;
  stores_compared: number;
  items_total: number;
  items_analyzed: number;
  below: number;
  above: number;
  top_raise: ResultItem[];
  dont_lower: ResultItem[];
  items: ResultItem[];
  by_category: { group: Group; items: number; items_compared: number; can_go_up: number; leave_alone: number; at_average: number; price_gap_per_sale_cents: number }[];
  pareto_count: number;
  left_out_items: string[];
  method_note: string;
  position: { rank: number; stores_ranked: number; price_index: number; items_compared: number } | null;
  previous_position: { xray_id: string; rank: number; stores_ranked: number } | null;
  doubts_open: number;
  only_yours: number;
  stores_read: number;
  stores_total: number;
  stores_left_out: number;
  /** Migration 20261230000002: M1-12 score, store position, per category score and position, per item position. */
  positions: {
    score: Score | null;
    store_position: { rank: number; stores_ranked: number; price_index: number } | null;
    by_category: { group: Group; score: Score | null; position: { rank: number; stores_ranked: number; price_index: number; items_compared: number } | null }[];
    items: { item_id: string; own_item_id: string; category: string | null; percentile: number; rank: number; stores: number; captured_cents: number | null; parity_cents: number | null }[];
  };
}

/** P23: a given run, or the newest calculated one. Null while nothing is calculated (the page sends to P21). */
export async function loadResult(deps: LoadDeps, monitorId: string, xrayId?: string): Promise<Result | null> {
  const id = xrayId ?? (await latestReadyRun(deps, monitorId));
  if (!id) return null;
  const run = await visibleRun(deps, monitorId, id);
  if (!run) return null;
  const [result, positions] = await Promise.all([
    deps.rpc("monitor_result", { p_xray: run.xrayId }) as Promise<Omit<Result, "positions">>,
    deps.rpc("monitor_positions", { p_xray: run.xrayId }) as Promise<Result["positions"]>,
  ]);
  if (!["ready", "delivered"].includes(result.status)) return null;
  return { ...result, positions };
}

// P24 / W15 -----------------------------------------------------------------------------------------------------------

export interface History {
  /** The first run with score and positions; runs before it carry nulls (draft: no interpolation). */
  series_from: string | null;
  runs: {
    xray_id: string;
    created_at: string;
    on: string | null;
    status: string;
    stores_read: number;
    items_compared: number;
    rank: number | null;
    stores_ranked: number | null;
    price_index: number | null;
    score: number | null;
    score_version: string | null;
    delta: number | null;
    delta_items: number | null;
    by_category: { group: Group; score: number | null; items: number; delta: number | null; delta_items: number | null; price_gap_per_sale_cents: number; risk: number; rank: number | null; stores_ranked: number | null }[];
  }[];
  picker: { own_item_id: string; name: string; category: string | null; group: Group }[];
}

export async function loadHistory(deps: LoadDeps, monitorId: string): Promise<History | null> {
  if (!(await visibleMonitor(deps, monitorId))) return null;
  const [h, picker] = await Promise.all([
    deps.rpc("monitor_history", { p_monitor: monitorId }) as Promise<Omit<History, "picker">>,
    deps.rpc("monitor_item_picker", { p_monitor: monitorId }) as Promise<History["picker"]>,
  ]);
  return { ...h, picker };
}

export interface ItemHistoryPoint {
  xray_id: string;
  on: string | null;
  own_cents: number | null;
  parity_cents: number | null;
  reading: string | null;
  category: string | null;
  percentile: number | null;
  rank: number | null;
  stores: number | null;
  captured_cents: number | null;
}

/** P24 "preço por item ao longo do tempo" for one own item (its public_menu_item id from the picker). */
export async function loadItemHistory(deps: LoadDeps, monitorId: string, ownItemId: string): Promise<ItemHistoryPoint[] | null> {
  if (!UUID.test(ownItemId) || !(await visibleMonitor(deps, monitorId))) return null;
  return (await deps.rpc("monitor_item_history", { p_monitor: monitorId, p_item: ownItemId })) as ItemHistoryPoint[];
}

// P23 extras (migration 20261231000001) ------------------------------------------------------------------------------

/** "Ver as lojas": per analyzed item, the accepted stores, cheapest first, named as the owner may see them (Q7). */
export type ResultStores = Record<string, { name: string; price_cents: number }[]>;

/** Competitor view "Você e o Concorrente": items both sell, from the newest own run whose neighborhood holds it. */
export interface HeadToHead {
  own_xray_id: string;
  own_store_name: string;
  on: string;
  items: { item_id: string; name: string; own_cents: number; their_cents: number; group: Group }[];
}

export interface ResultPage {
  result: Result;
  stores: ResultStores;
  headToHead: HeadToHead | null;
}

async function resultPage(rpc: LoadDeps["rpc"], xrayId: string): Promise<ResultPage | null> {
  const [result, positions, stores, h2h] = await Promise.all([
    rpc("monitor_result", { p_xray: xrayId }) as Promise<Omit<Result, "positions"> | null>,
    rpc("monitor_positions", { p_xray: xrayId }) as Promise<Result["positions"]>,
    rpc("monitor_result_stores", { p_xray: xrayId }) as Promise<{ item_id: string; stores: { name: string; price_cents: number }[] }[]>,
    rpc("monitor_head_to_head", { p_xray: xrayId }) as Promise<HeadToHead | null>,
  ]);
  if (!result || !["ready", "delivered"].includes(result.status)) return null;
  return {
    result: { ...result, positions },
    stores: Object.fromEntries((stores ?? []).map((s) => [s.item_id, s.stores])),
    headToHead: h2h && h2h.items?.length ? h2h : null,
  };
}

/** P23 with its store lists and the competitor head-to-head: a given run of a visible monitoring, or the newest. */
export async function loadResultPage(deps: LoadDeps, monitorId: string, xrayId?: string): Promise<ResultPage | null> {
  const id = xrayId ?? (await latestReadyRun(deps, monitorId));
  if (!id) return null;
  const run = await visibleRun(deps, monitorId, id);
  return run ? resultPage(deps.rpc, run.xrayId) : null;
}

/**
 * The printed copy (/imprimir/raio-x/[xray]): no person here, so the caller has checked worker-render's one-time token
 * (lib/monitor/print.ts) before this service-role read. Same data as P23.
 */
export async function loadResultPageForPrint(rpc: LoadDeps["rpc"], xrayId: string): Promise<ResultPage | null> {
  return UUID.test(xrayId) ? resultPage(rpc, xrayId) : null;
}

/** m1.score_min_items (M1-12): a category under it shows "poucos itens". rule_param is readable by members. */
export async function scoreMinItems(db: ReadDb): Promise<number> {
  const { data } = await db.from("rule_param").select("value").eq("key", "m1.score_min_items").maybeSingle();
  return data ? Number(data.value) : 5;
}

/** One row of P19 for a visible monitoring (store name, area, latest run), for the P21 to P24 headers. */
export async function loadMonitorSummary(deps: LoadDeps, monitorId: string): Promise<MonitorSummary | null> {
  if (!(await visibleMonitor(deps, monitorId))) return null;
  const rows = (await deps.rpc("monitor_summaries", { p_monitors: [monitorId] })) as MonitorSummary[];
  return rows[0] ?? null;
}
