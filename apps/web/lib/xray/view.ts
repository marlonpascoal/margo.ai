// What the M1 screens show, derived from the stored X-ray rows. No rule is computed here: readings,
// parity, gaps and the Pareto ranks come from the worker (M1-03 to M1-08); this only counts and orders.
import type { PairStatus, Reading } from "./labels";

export interface NeighborRow {
  id: string;
  name: string;
  category: string | null;
  distanceM: number;
  included: boolean;
  reason: string | null;
  lat: number | null;
  lng: number | null;
  /** The store's capture (public.xray_capture_states); null with no capture job. */
  capture: CaptureState | null;
  /** M1-11, null for a store the filters left out or from before the rule. */
  captureRank: number | null;
  captureScore: number | null;
  /** The store's capture had not finished when pairing last ran (xray_store.left_out_of_pairing). */
  leftOut?: boolean;
}

export type CaptureState = "done" | "missing" | "failed" | "beyond_cap";

/** C03: the captures of this X-ray. Stores past the cap (D47c) are neither missing nor failed. */
export function captureCounts(rows: { state: string }[]) {
  const n = (s: CaptureState) => rows.filter((r) => r.state === s).length;
  return { done: n("done"), missing: n("missing"), failed: n("failed"), beyondCap: n("beyond_cap"), total: rows.length };
}

/** C03 counts: found, in the set, excluded. */
export function neighborhoodCounts(rows: Pick<NeighborRow, "included">[]) {
  const inSet = rows.filter((r) => r.included).length;
  return { found: rows.length, inSet, excluded: rows.length - inSet };
}

/** C03 status text of a store, as drawn: "no conjunto" or its exclusion reason. A store in the set whose capture
 * failed or stayed past the cap says so (not drawn). */
export function storeState(r: Pick<NeighborRow, "included" | "reason" | "leftOut"> & { capture?: CaptureState | null }): string {
  if (!r.included) return r.reason ?? "manual";
  if (r.leftOut) return "no conjunto, fora do pareamento";
  if (r.capture === "failed") return "no conjunto, captura falhou";
  if (r.capture === "beyond_cap") return "no conjunto, sem captura pelo limite";
  return "no conjunto";
}

/** C03 map placeholder: offset of a store from the target in px, `scale` px per km (north up). */
export function mapOffset(target: { lat: number; lng: number }, s: { lat: number; lng: number }, scalePxPerKm: number) {
  const kmNorth = (s.lat - target.lat) * 111.195;
  const kmEast = (s.lng - target.lng) * 111.195 * Math.cos((target.lat * Math.PI) / 180);
  return { x: kmEast * scalePxPerKm, y: -kmNorth * scalePxPerKm };
}

export interface ItemRow {
  id: string;
  name: string;
  ownCents: number;
  normUnit: string;
  normPriceCents: number;
  parityCents: number | null;
  gapPct: number | null;
  /** M1-05: parity at full prices; null in a run calculated before dual parity. */
  parityFullCents: number | null;
  gapFullPct: number | null;
  /** M1-07: `na_media` with the full-price gap at or below minus the band. */
  fullPriceRoom: boolean;
  lossCents: number | null;
  reading: Reading | null;
  pairStatus: PairStatus;
  pairNote: string | null;
  reviewed: boolean;
  skipped: boolean;
  paretoRank: number | null;
  paretoCumShare: number | null;
  comparables: number;
  /** M1-05: accepted pairs, by the rule or a founder (xray_item_view). */
  acceptedPairs: number;
  exampleName: string | null;
  exampleCents: number | null;
}

/** C04 chips: items, paired alone, to review, normalized by weight (M1-03, M1-04 outcomes). */
export function pairingTotals(items: Pick<ItemRow, "pairStatus">[]) {
  const n = (s: PairStatus) => items.filter((i) => i.pairStatus === s).length;
  return { items: items.length, auto: n("auto"), review: n("revisar"), normalized: n("normalizado") };
}

/** C04: "Calcular raio-X" stays disabled while a `revisar` item is neither reviewed nor skipped. */
export const pendingReview = (items: Pick<ItemRow, "pairStatus" | "reviewed" | "skipped">[]) =>
  items.filter((i) => i.pairStatus === "revisar" && !i.reviewed && !i.skipped).length;

/** M1-05: paired items with no parity, because too few stores sell the same item. A skipped item, one to review or an
 * exclusive one is not one. */
export const withoutParity = <T extends Pick<ItemRow, "parityCents" | "acceptedPairs" | "skipped" | "pairStatus">>(items: T[]) =>
  items.filter((i) => i.parityCents === null && i.acceptedPairs > 0 && !i.skipped && i.pairStatus !== "revisar" && i.pairStatus !== "exclusivo");

/** M1-04 Stage 2: exclusive items with no parity: no problem, outside parity, loss and the Pareto. One a founder paired
 * by hand has a parity and is in the table instead. */
export const exclusives = <T extends Pick<ItemRow, "parityCents" | "skipped" | "pairStatus">>(items: T[]) =>
  items.filter((i) => i.pairStatus === "exclusivo" && i.parityCents === null && !i.skipped);

/** C04 "Exemplo de par": the name, with the price for a normalized item ("Fritas 400 g, R$ 22,00"). */
export function examplePair(i: Pick<ItemRow, "exampleName" | "exampleCents" | "normUnit">, money: (c: number) => string): string {
  if (!i.exampleName) return "";
  return i.normUnit === "100g" || i.normUnit === "100ml" ? `${i.exampleName}, ${money(i.exampleCents ?? 0)}` : i.exampleName;
}

/** C05 secondary line (M1-05, M1-06): the full-price parity and gap, when the parity or the gap differs from the current one.
 * A promotion at the neighbors moves the parity; one at the target alone moves only the gap. */
export function fullParityInfo(i: Pick<ItemRow, "parityCents" | "gapPct" | "parityFullCents" | "gapFullPct">): { cents: number; gap: number } | null {
  if (i.parityFullCents === null || i.gapFullPct === null) return null;
  if (i.parityFullCents === i.parityCents && i.gapFullPct === i.gapPct) return null;
  return { cents: i.parityFullCents, gap: i.gapFullPct };
}

const ORDER: Record<Reading, number> = { pode_subir: 0, na_media: 1, nao_mexer: 2 };

/** C05: KPIs, the table (most below parity first, then the band, then most above) and the Pareto. */
export function xrayResult(items: ItemRow[]) {
  const analyzed = items.filter((i) => i.parityCents !== null && !i.skipped);
  const rows = [...analyzed].sort(
    (a, b) => ORDER[a.reading!] - ORDER[b.reading!] || Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0) || a.name.localeCompare(b.name),
  );
  const ranked = analyzed.filter((i) => i.paretoRank !== null).sort((a, b) => a.paretoRank! - b.paretoRank!);
  const n80 = ranked.find((i) => (i.paretoCumShare ?? 0) >= 0.8)?.paretoRank ?? 0;
  const top = ranked.slice(0, n80);
  const maxLoss = top[0]?.lossCents ?? 0;
  return {
    analyzed: analyzed.length,
    below: analyzed.filter((i) => i.reading === "pode_subir").length,
    above: analyzed.filter((i) => i.reading === "nao_mexer").length,
    rows,
    withoutParity: withoutParity(items).map((i) => i.name),
    exclusives: exclusives(items).map((i) => i.name),
    paretoCount: n80,
    pareto: top.map((i) => ({ name: i.name, width: maxLoss ? Math.round(((i.lossCents ?? 0) / maxLoss) * 100) : 0, cumShare: i.paretoCumShare ?? 0 })),
    /** M1-09: how many prices to raise go in P01 and the message (at most 3). */
    toRaise: Math.min(3, analyzed.filter((i) => i.reading === "pode_subir").length),
  };
}

// History (M1 history, M1-10 proposed) ----------------------------------------------------------------

export interface HistoryRun {
  xrayId: string;
  collectedAt: string;
  /** M1-10: the target's position by price index among the stores ranked in that run; null before the calculation. */
  rank: { rank: number; of: number; priceIndex: number } | null;
}

export interface HistoryPrice {
  xrayId: string;
  itemId: string;
  name: string;
  priceCents: number;
}

/** C05 history: the last `max` runs, oldest first, and per item its price in each of them (null when the
 * item was not on the menu that run). Items that changed price come first, then by name. */
export function priceHistory(runs: HistoryRun[], prices: HistoryPrice[], max = 6) {
  const shown = [...runs].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).slice(-max);
  const byItem = new Map<string, { name: string; cells: Map<string, number> }>();
  for (const p of prices) {
    const e = byItem.get(p.itemId) ?? { name: p.name, cells: new Map<string, number>() };
    e.cells.set(p.xrayId, p.priceCents);
    byItem.set(p.itemId, e);
  }
  const items = [...byItem.entries()].map(([id, e]) => {
    const cells = shown.map((r) => e.cells.get(r.xrayId) ?? null);
    const seen = cells.filter((c): c is number => c !== null);
    return { id, name: e.name, cells, changed: new Set(seen).size > 1 };
  });
  items.sort((a, b) => Number(b.changed) - Number(a.changed) || a.name.localeCompare(b.name, "pt-BR"));
  return { runs: shown, items };
}
