// Reads for the M1 console screens, with the service role, after requireConsole("clients") (02 §5).
import type { Db } from "@/lib/supabase/admin";
import type { ItemRow, NeighborRow } from "./view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** A list read: throws on error, never null. */
function list<T>(res: { data: T[] | null; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

export type XrayStatus = "draft" | "collecting" | "pairing" | "ready" | "delivered";

export interface XrayHead {
  id: string;
  accountId: string | null;
  status: XrayStatus;
  radiusKm: number;
  storeName: string | null;
  storeUrl: string | null;
  target: { lat: number; lng: number } | null;
  synthetic: boolean;
  pdfPath: string | null;
  collectedAt: string | null;
}

/** The X-ray and its target store; null for an unknown id (the page answers 404). */
export async function loadXrayHead(db: Db, id: string): Promise<XrayHead | null> {
  if (!isUuid(id)) return null;
  const x = check(
    await db
      .from("xray")
      .select("id, account_id, status, radius_km, pdf_path, collected_at, public_store!xray_target_store_id_fkey(name, url, lat, lng), account(is_synthetic)")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!x) return null;
  const s = x.public_store;
  return {
    id: x.id,
    accountId: x.account_id,
    status: x.status,
    radiusKm: x.radius_km,
    storeName: s?.name ?? null,
    storeUrl: s?.url ?? null,
    target: s?.lat != null && s?.lng != null ? { lat: Number(s.lat), lng: Number(s.lng) } : null,
    synthetic: x.account?.is_synthetic ?? false,
    pdfPath: x.pdf_path,
    collectedAt: x.collected_at,
  };
}

export interface JobState {
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  reason: string | null;
}

/** The newest job of a type for this X-ray, with the failure from its last log entry. */
export async function latestJob(db: Db, type: string, xrayId: string): Promise<JobState | null> {
  const rows = list(
    await db.from("job").select("status, log").eq("type", type).eq("payload->>xray_id", xrayId).order("created_at", { ascending: false }).limit(1),
  );
  const j = rows[0];
  if (!j) return null;
  const log = Array.isArray(j.log) ? (j.log as Record<string, unknown>[]) : [];
  const last = log[log.length - 1] ?? {};
  return { status: j.status, error: typeof last.error === "string" ? last.error : null, reason: typeof last.reason === "string" ? last.reason : null };
}

/** C03 list, nearest first. */
export async function loadNeighborhood(db: Db, xrayId: string): Promise<NeighborRow[]> {
  const rows = list(
    await db
      .from("xray_store")
      .select("id, distance_m, included, exclusion_reason, public_store(name, category, lat, lng)")
      .eq("xray_id", xrayId)
      .order("distance_m"),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.public_store?.name ?? "",
    category: r.public_store?.category ?? null,
    distanceM: r.distance_m,
    included: r.included,
    reason: r.exclusion_reason,
    lat: r.public_store?.lat != null ? Number(r.public_store.lat) : null,
    lng: r.public_store?.lng != null ? Number(r.public_store.lng) : null,
  }));
}

/** C04, C05 items (xray_item_view), in menu order of the C04 table: to review first, then by name. */
export async function loadItems(db: Db, xrayId: string): Promise<ItemRow[]> {
  const rows = list(await db.from("xray_item_view").select("*").eq("xray_id", xrayId).order("name"));
  return rows.map((r) => ({
    id: r.id!,
    name: r.name!,
    ownCents: r.own_cents!,
    normUnit: r.norm_unit!,
    normPriceCents: r.norm_price_cents!,
    parityCents: r.parity_cents,
    gapPct: r.gap_pct === null ? null : Number(r.gap_pct),
    lossCents: r.loss_cents,
    reading: r.reading,
    pairStatus: r.pair_status!,
    pairNote: r.pair_note,
    reviewed: r.reviewed_at !== null,
    skipped: r.skipped ?? false,
    paretoRank: r.pareto_rank,
    paretoCumShare: r.pareto_cum_share === null ? null : Number(r.pareto_cum_share),
    comparables: r.comparables ?? 0,
    exampleName: r.example_name,
    exampleCents: r.example_cents,
  }));
}

export interface PairRow {
  id: string;
  name: string;
  store: string;
  priceCents: number;
  similarity: number;
  accepted: boolean;
}

/** C04 row opened: the comparable items of one X-ray item. */
export async function loadPairs(db: Db, xrayId: string, itemId: string): Promise<PairRow[]> {
  if (!isUuid(itemId)) return [];
  const rows = list(
    await db
      .from("xray_pair")
      .select("id, similarity, accepted, public_menu_item(name, price_cents, public_store(name)), xray_item!inner(xray_id)")
      .eq("xray_item_id", itemId)
      .eq("xray_item.xray_id", xrayId)
      .order("similarity", { ascending: false }),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.public_menu_item?.name ?? "",
    store: r.public_menu_item?.public_store?.name ?? "",
    priceCents: r.public_menu_item?.price_cents ?? 0,
    similarity: Number(r.similarity),
    accepted: r.accepted,
  }));
}

/** C02 "Loja encontrada": name, area and category of a store already in the public catalog. */
export async function lookupStore(db: Db, externalId: string) {
  return check(
    await db.from("public_store").select("name, area, category").eq("channel", "ifood").eq("external_id", externalId).not("name", "is", null).maybeSingle(),
  );
}

export type Step = "vizinhanca" | "pareamento" | "entrega";

/** C06: this person's minutes per step. */
export async function loadMinutes(db: Db, xrayId: string, personId: string): Promise<Partial<Record<Step, number>>> {
  const rows = list(await db.from("time_log").select("step, minutes").eq("xray_id", xrayId).eq("person_id", personId));
  return Object.fromEntries(rows.map((r) => [r.step, r.minutes]));
}
