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
}

/** C03 counts: found, in the set, excluded. */
export function neighborhoodCounts(rows: Pick<NeighborRow, "included">[]) {
  const inSet = rows.filter((r) => r.included).length;
  return { found: rows.length, inSet, excluded: rows.length - inSet };
}

/** C03 status text of a store, as drawn: "no conjunto" or its exclusion reason. */
export const storeState = (r: Pick<NeighborRow, "included" | "reason">) => (r.included ? "no conjunto" : (r.reason ?? "manual"));

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
  lossCents: number | null;
  reading: Reading | null;
  pairStatus: PairStatus;
  pairNote: string | null;
  reviewed: boolean;
  skipped: boolean;
  paretoRank: number | null;
  paretoCumShare: number | null;
  comparables: number;
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

/** C04 "Exemplo de par": the name, with the price for a normalized item ("Fritas 400 g, R$ 22,00"). */
export function examplePair(i: Pick<ItemRow, "exampleName" | "exampleCents" | "normUnit">, money: (c: number) => string): string {
  if (!i.exampleName) return "";
  return i.normUnit === "100g" || i.normUnit === "100ml" ? `${i.exampleName}, ${money(i.exampleCents ?? 0)}` : i.exampleName;
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
    paretoCount: n80,
    pareto: top.map((i) => ({ name: i.name, width: maxLoss ? Math.round(((i.lossCents ?? 0) / maxLoss) * 100) : 0, cumShare: i.paretoCumShare ?? 0 })),
    /** M1-09: how many prices to raise go in P01 and the message (at most 3). */
    toRaise: Math.min(3, analyzed.filter((i) => i.reading === "pode_subir").length),
  };
}
