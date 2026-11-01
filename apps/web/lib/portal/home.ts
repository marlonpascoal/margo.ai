// P08 / W01 Início (05 §B): the month's numbers for the kitchens this person may see (04 §5, A03).
// Numbers come from close_line and difference, computed by worker-import with REP-01 to REP-05 and
// DIF-01 to DIF-05 (04 §2). "Sobrou depois dos insumos" is CTB-01 for the month: what the apps paid (C08)
// minus the insumos of the dishes sold (C13 insumos times units, close_cost_line, worker-cost). A store
// without cost, or with a dish sold without a ficha, shows "falta custo", as does the total.
import type { Database } from "@margoai/contracts";
import { CHANNEL_LABEL, CHANNEL_ORDER, type Channel } from "@/lib/m2/format";
import { closePeriods, type ClosePeriod } from "@/lib/m2/close";
import type { Db } from "@/lib/supabase/admin";
import { kitchenShort } from "./format";
import type { Member } from "./session";

type ContestationStatus = Database["public"]["Enums"]["contestation_status"];
type Confidence = Database["public"]["Enums"]["difference_confidence"];

export interface HomeLine {
  kitchenId: string | null;
  kitchenName: string | null;
  channel: Channel;
  gross: number;
  payout: number;
  /** Insumos (ingredients plus packaging) of the dishes sold; null when unknown (no cost, or a dish without ficha). */
  insumos: number | null;
}

export interface HomeDiff {
  kitchenId: string | null;
  amount: number;
  confidence: Confidence;
  /** null: no contestation (a doubtful difference, or DIF-04 still waiting). */
  status: ContestationStatus | null;
  /** "Foi combinado? Sim": closed with no difference (04 §3). */
  closed?: boolean;
}

export interface HomeRow {
  label: string;
  soldCents: number;
  appTookCents: number;
  /** CTB-01: received minus insumos; null shows "falta custo". */
  leftCents: number | null;
}

export interface HomeNumbers {
  /** "vendido no delivery": gross of the close lines (REP-05 base). */
  soldCents: number;
  /** "recebido dos apps": expected payout actually received (REP-05). */
  receivedCents: number;
  receivedPct: number;
  /** "cobrado errado": differences the owner sees (DIF-01 to DIF-05, certa and provável). */
  wrongCents: number;
  /** "N para você contestar": contestations a_contestar (04 §3). */
  toContest: number;
  /** "sobrou depois dos insumos" (CTB-01): received minus insumos; null while any row lacks cost. */
  leftCents: number | null;
  leftPct: number;
  /** Table per kitchen and app: "O app levou" = gross minus payout (REP-01 to REP-04). */
  rows: HomeRow[];
}

/** W01 KPIs and table (REP-05, DIF-01 to DIF-05). `kitchenId`: the kitchen selector, null for all. */
export function homeNumbers(lines: HomeLine[], diffs: HomeDiff[], kitchenId: string | null): HomeNumbers {
  const ls = kitchenId ? lines.filter((l) => l.kitchenId === kitchenId) : lines;
  const ds = (kitchenId ? diffs.filter((d) => d.kitchenId === kitchenId) : diffs).filter((d) => d.confidence !== "duvidosa" && !d.closed);
  const soldCents = ls.reduce((a, l) => a + l.gross, 0);
  const receivedCents = ls.reduce((a, l) => a + l.payout, 0);

  const groups = new Map<string, { name: string | null; channel: Channel; sold: number; payout: number; insumos: number | null }>();
  for (const l of ls) {
    const key = `${l.kitchenId ?? ""}|${l.channel}`;
    const g = groups.get(key) ?? { name: l.kitchenName, channel: l.channel, sold: 0, payout: 0, insumos: 0 };
    g.sold += l.gross;
    g.payout += l.payout;
    g.insumos = g.insumos === null || l.insumos === null ? null : g.insumos + l.insumos;
    groups.set(key, g);
  }
  const rows = [...groups.values()]
    .sort(
      (a, b) =>
        Number(a.name === null) - Number(b.name === null) ||
        (a.name ?? "").localeCompare(b.name ?? "", "pt-BR") ||
        CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel),
    )
    .map((g) => ({
      label: `${g.name ? kitchenShort(g.name) : "Sem cozinha"} · ${CHANNEL_LABEL[g.channel]}`,
      soldCents: g.sold,
      appTookCents: g.sold - g.payout,
      leftCents: g.insumos === null ? null : g.payout - g.insumos,
    }));
  const leftCents = rows.length > 0 && rows.every((r) => r.leftCents !== null) ? rows.reduce((a, r) => a + (r.leftCents ?? 0), 0) : null;

  return {
    soldCents,
    receivedCents,
    receivedPct: soldCents === 0 ? 0 : Math.round((receivedCents * 100) / soldCents),
    wrongCents: ds.reduce((a, d) => a + d.amount, 0),
    toContest: ds.filter((d) => d.status === "a_contestar").length,
    rows,
    leftCents,
    leftPct: leftCents === null || soldCents === 0 ? 0 : Math.round((leftCents * 100) / soldCents),
  };
}

export interface ScopeKitchen {
  id: string;
  name: string;
  inAnalysis: boolean;
}

/** Kitchens of the account this member may see (04 §5), by name. */
export async function scopeKitchens(db: Db, m: Pick<Member, "account" | "kitchenIds">): Promise<ScopeKitchen[]> {
  if (m.kitchenIds.length === 0) return [];
  const { data, error } = await db.from("kitchen").select("id, name, in_analysis").eq("account_id", m.account.id).in("id", m.kitchenIds);
  if (error) throw new Error(error.message);
  return (data ?? []).map((k) => ({ id: k.id, name: k.name, inAnalysis: k.in_analysis })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** W01 with flag m3.custo off (04 §6): the lines without insumos, so "sobrou" shows "falta custo". */
export function withoutCost(lines: HomeLine[]): HomeLine[] {
  return lines.map((l) => ({ ...l, insumos: null }));
}

/** A03: close lines of one account-level close, only for stores of kitchens in scope (all, with "sem cozinha", when allKitchens). */
export async function loadHomeLines(db: Db, closeId: string, m: Pick<Member, "allKitchens" | "kitchenIds">): Promise<HomeLine[]> {
  const [{ data, error }, { data: costs, error: costError }] = await Promise.all([
    db.from("close_line").select("channel_store_id, gross_cents, payout_cents, channel_store(channel, kitchen_id, kitchen(name))").eq("close_period_id", closeId),
    db.from("close_cost_line").select("channel_store_id, uncovered_units, ingredient_cents, packaging_cents").eq("close_period_id", closeId),
  ]);
  if (error) throw new Error(error.message);
  if (costError) throw new Error(costError.message);
  const insumos = new Map((costs ?? []).map((c) => [c.channel_store_id, c.uncovered_units > 0 ? null : c.ingredient_cents + c.packaging_cents] as const));
  const scope = new Set(m.kitchenIds);
  return (data ?? [])
    .filter((l) => l.channel_store && (m.allKitchens || (l.channel_store.kitchen_id !== null && scope.has(l.channel_store.kitchen_id))))
    .map((l) => ({
      kitchenId: l.channel_store!.kitchen_id,
      kitchenName: l.channel_store!.kitchen?.name ?? null,
      channel: l.channel_store!.channel,
      gross: l.gross_cents,
      payout: l.payout_cents,
      insumos: insumos.get(l.channel_store_id) ?? null,
    }));
}

/** A03: differences of one close, shown ones only (04 §2), in scope. */
export async function loadHomeDiffs(db: Db, closeId: string, m: Pick<Member, "allKitchens" | "kitchenIds">): Promise<HomeDiff[]> {
  const { data, error } = await db
    .from("difference")
    .select("amount_cents, confidence, channel_store(kitchen_id), contestation(status, closed_at)")
    .eq("close_period_id", closeId)
    .eq("shown", true);
  if (error) throw new Error(error.message);
  const scope = new Set(m.kitchenIds);
  return (data ?? [])
    .filter((d) => d.channel_store && (m.allKitchens || (d.channel_store.kitchen_id !== null && scope.has(d.channel_store.kitchen_id))))
    .map((d) => {
      const c = Array.isArray(d.contestation) ? d.contestation[0] : d.contestation;
      return { kitchenId: d.channel_store!.kitchen_id, amount: d.amount_cents, confidence: d.confidence, status: c?.status ?? null, closed: !!c?.closed_at };
    });
}

/** Month list for the selector: account-level closes, newest first (same as C08). */
export const homePeriods = (db: Db, accountId: string): Promise<ClosePeriod[]> => closePeriods(db, accountId);

export interface HomeReport {
  kind: "close" | "xray";
  id: string;
  href: string;
  /** "05/out": when it was made. */
  at: string | null;
  month?: string;
}

/**
 * W01 "Relatórios", P08 list. The closing PDF and the X-ray cover the whole account, so a person who sees
 * only some kitchens gets neither (A03: "pages, PDFs, exports").
 */
export async function loadReports(db: Db, m: Pick<Member, "account" | "allKitchens">): Promise<HomeReport[]> {
  if (!m.allKitchens) return [];
  const [{ data: closes }, { data: xrays }] = await Promise.all([
    db.from("close_period").select("id, month, computed_at").eq("account_id", m.account.id).is("kitchen_id", null).not("pdf_path", "is", null).order("month", { ascending: false }).limit(1),
    db.from("xray").select("id, delivered_at, created_at").eq("account_id", m.account.id).not("pdf_path", "is", null).order("created_at", { ascending: false }).limit(1),
  ]);
  const out: HomeReport[] = [];
  for (const c of closes ?? []) out.push({ kind: "close", id: c.id, href: `/app/relatorios/fechamento/${c.id}/pdf`, at: c.computed_at, month: c.month });
  for (const x of xrays ?? []) out.push({ kind: "xray", id: x.id, href: `/app/relatorios/raio-x/${x.id}`, at: x.delivered_at ?? x.created_at });
  return out;
}
