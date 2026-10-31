// C08 Fechamento and C09 Diferenças (design/C08-Fechamento.dc.html, design/C09-Diferencas.dc.html, 05 §A).
// Numbers come from close_line and difference, which worker-import computes with REP-01 to REP-05 and
// DIF-01 to DIF-05 (04 §2); this module only adds them up per channel and words them as drawn.
import type { Database } from "@margoai/contracts";
import { closeReadyEmail, emailSource } from "@/emails";
import { notify } from "@/lib/notify/outbox";
import type { MessageSource } from "@/lib/notify/templates";
import { SupabaseNotifyStore } from "@/lib/notify/supabase-store";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { enqueueDeps } from "@/lib/jobs/deps";
import type { Db } from "@/lib/supabase/admin";
import { audit, type M2Account } from "./account";
import { brl, CHANNEL_LABEL, CHANNEL_ORDER, dayMon, deduction, monthShort, percent, plural, type Channel } from "./format";
import { closeLeftCents } from "@/lib/m3/data";

type Confidence = Database["public"]["Enums"]["difference_confidence"];
type ContestationStatus = Database["public"]["Enums"]["contestation_status"];

const COLUMNS = ["gross", "commission", "payment", "delivery", "promotion", "anticipation", "payout"] as const;
type Column = (typeof COLUMNS)[number];
export type Sums = Record<Column, number>;

export interface LineRecord extends Sums {
  channel: Channel;
}

export interface CloseRow {
  channel: string;
  cells: string[];
  total: boolean;
}

const zero = (): Sums => ({ gross: 0, commission: 0, payment: 0, delivery: 0, promotion: 0, anticipation: 0, payout: 0 });

/** C08 table: one row per channel plus Total; deductions as drawn ("−11.088"), % of gross. */
export function closeRows(lines: LineRecord[]): CloseRow[] {
  const by = new Map<Channel, Sums>();
  for (const l of lines) {
    const s = by.get(l.channel) ?? zero();
    for (const c of COLUMNS) s[c] += l[c];
    by.set(l.channel, s);
  }
  const row = (label: string, s: Sums, total: boolean): CloseRow => ({
    channel: label,
    cells: [brl(s.gross), deduction(s.commission), deduction(s.payment), deduction(s.delivery), deduction(s.promotion), deduction(s.anticipation), brl(s.payout), percent(s.payout, s.gross)],
    total,
  });
  const channels = CHANNEL_ORDER.filter((c) => by.has(c));
  const rows = channels.map((c) => row(CHANNEL_LABEL[c], by.get(c)!, false));
  if (channels.length > 1) {
    const t = zero();
    for (const s of by.values()) for (const c of COLUMNS) t[c] += s[c];
    rows.push(row("Total", t, true));
  }
  return rows;
}

export interface DifferenceRecord {
  id: string;
  rule_id: string;
  description: string;
  channel: Channel;
  store: string;
  orders_count: number;
  amount_cents: number;
  confidence: Confidence;
  detail: Record<string, unknown>;
  contestation: {
    id: string;
    status: ContestationStatus;
    deadline_on: string | null;
    marked_at: string | null;
    closed_at: string | null;
    credited_cents: number | null;
  } | null;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { certa: "certa", provavel: "provável", duvidosa: "duvidosa" };

/** A DIF-04 with no payout yet, inside its wait (C16 "esperando repasse"). */
export const isWaiting = (d: DifferenceRecord) => d.rule_id === "DIF-04" && d.confidence === "provavel" && !d.contestation;

/** C09 "Contestação" column. */
export function contestationLabel(d: DifferenceRecord, today: string): string {
  const c = d.contestation;
  if (isWaiting(d)) return "esperar o próximo ciclo";
  if (!c) return d.confidence === "duvidosa" ? "só no console" : "";
  if (c.closed_at) return "não era erro";
  switch (c.status) {
    case "a_contestar":
      return c.deadline_on && c.deadline_on < today ? "prazo vencido" : `contestar até ${c.deadline_on ? dayMon(c.deadline_on) : ""}`.trim();
    case "precisa_resposta":
      return "perguntar ao dono";
    case "contestada":
      return `contestada em ${c.marked_at ? dayMon(c.marked_at.slice(0, 10)) : ""}`.trim();
    case "creditada":
      return `creditado ${brl(c.credited_cents ?? d.amount_cents)}`;
    case "negada":
      return "negada";
    case "prazo_vencido":
      return "prazo vencido";
  }
}

/** C09 order: certain first, then probable, then doubtful; larger first. */
export function sortDifferences<T extends Pick<DifferenceRecord, "confidence" | "amount_cents" | "rule_id">>(ds: T[]): T[] {
  const rank: Record<Confidence, number> = { certa: 0, provavel: 1, duvidosa: 2 };
  return [...ds].sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.amount_cents - a.amount_cents || a.rule_id.localeCompare(b.rule_id));
}

export interface DifferenceSummary {
  count: number;
  total: number;
  certain: { count: number; total: number };
  probable: { count: number; total: number };
}

export function summarize(ds: DifferenceRecord[]): DifferenceSummary {
  const pick = (c: Confidence) => ds.filter((d) => d.confidence === c);
  const sum = (xs: DifferenceRecord[]) => xs.reduce((a, d) => a + d.amount_cents, 0);
  return {
    count: ds.length,
    total: sum(ds),
    certain: { count: pick("certa").length, total: sum(pick("certa")) },
    probable: { count: pick("provavel").length, total: sum(pick("provavel")) },
  };
}

/** C08 banner: "6 diferenças no repasse", ", somando", "R$ 1.184", ". 4 certas, 2 prováveis." */
export function bannerParts(s: DifferenceSummary): [string, string, string, string] {
  const kinds = [s.certain.count ? plural(s.certain.count, "certa", "certas") : null, s.probable.count ? plural(s.probable.count, "provável", "prováveis") : null].filter(Boolean);
  return [plural(s.count, "diferença no repasse", "diferenças no repasse"), ", somando", brl(s.total), `. ${kinds.join(", ")}.`];
}

export interface ClosePeriod {
  id: string;
  month: string;
  status: Database["public"]["Enums"]["close_status"];
  pdfPath: string | null;
}

export async function closePeriods(db: Db, accountId: string): Promise<ClosePeriod[]> {
  const { data, error } = await db.from("close_period").select("id, month, status, pdf_path").eq("account_id", accountId).is("kitchen_id", null).order("month", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ id: c.id, month: c.month, status: c.status, pdfPath: c.pdf_path }));
}

export const monthOptions = (ps: ClosePeriod[]) => ps.map((p) => ({ value: p.month.slice(0, 7), label: monthShort(p.month) }));

export async function loadClose(db: Db, closeId: string): Promise<{ lines: LineRecord[]; stores: number }> {
  const { data, error } = await db
    .from("close_line")
    .select("gross_cents, commission_cents, payment_cents, delivery_cents, promotion_cents, anticipation_cents, payout_cents, channel_store(channel)")
    .eq("close_period_id", closeId);
  if (error) throw new Error(error.message);
  const lines = (data ?? []).map((l) => ({
    channel: l.channel_store!.channel,
    gross: l.gross_cents,
    commission: l.commission_cents,
    payment: l.payment_cents,
    delivery: l.delivery_cents,
    promotion: l.promotion_cents,
    anticipation: l.anticipation_cents,
    payout: l.payout_cents,
  }));
  return { lines, stores: lines.length };
}

/** Differences shown (04 §2: below R$ 5,00 per rule per month they are recorded, not shown). */
export async function loadDifferences(db: Db, closeId: string): Promise<DifferenceRecord[]> {
  const { data, error } = await db
    .from("difference")
    .select("id, rule_id, description, orders_count, amount_cents, confidence, detail, channel_store(channel, name), contestation(id, status, deadline_on, marked_at, closed_at, ledger_entry(amount_cents))")
    .eq("close_period_id", closeId)
    .eq("shown", true);
  if (error) throw new Error(error.message);
  return sortDifferences(
    (data ?? []).map((d) => {
      const c = Array.isArray(d.contestation) ? d.contestation[0] : d.contestation;
      return {
        id: d.id,
        rule_id: d.rule_id,
        description: d.description,
        channel: d.channel_store!.channel,
        store: d.channel_store!.name,
        orders_count: d.orders_count,
        amount_cents: d.amount_cents,
        confidence: d.confidence,
        detail: (d.detail ?? {}) as Record<string, unknown>,
        contestation: c
          ? { id: c.id, status: c.status, deadline_on: c.deadline_on, marked_at: c.marked_at, closed_at: c.closed_at, credited_cents: c.ledger_entry?.amount_cents ?? null }
          : null,
      };
    }),
  );
}

/** Differences still to contest: no contestation yet, or waiting for the owner (04 §3). */
const toContest = (d: DifferenceRecord) => !d.contestation || (!d.contestation.closed_at && ["a_contestar", "precisa_resposta"].includes(d.contestation.status));

/** E01 for one close: C08 totals (REP), what was left (CTB-01, once M3 has cost), differences to contest (DIF), P06 attached. */
export async function closeReadyMessage(db: Db, account: M2Account, close: ClosePeriod): Promise<MessageSource> {
  const [{ lines }, diffs, kitchens, leftCents] = await Promise.all([
    loadClose(db, close.id),
    loadDifferences(db, close.id),
    db.from("kitchen").select("id", { count: "exact", head: true }).eq("account_id", account.id).eq("in_analysis", true),
    closeLeftCents(db, close.id),
  ]);
  const channels = CHANNEL_ORDER.filter((c) => lines.some((l) => l.channel === c)).map((c) => CHANNEL_LABEL[c]);
  const ym = close.month.slice(0, 7);
  const content = closeReadyEmail({
    accountName: account.name,
    month: close.month,
    kitchens: kitchens.count ?? 0,
    channels,
    grossCents: lines.reduce((a, l) => a + l.gross, 0),
    payoutCents: lines.reduce((a, l) => a + l.payout, 0),
    leftCents,
    wrongCents: diffs.filter(toContest).reduce((a, d) => a + d.amount_cents, 0),
  });
  // worker-render writes the PDF at this path (render_close); the outbox attaches it once it exists.
  return emailSource(content, { synthetic: account.isSynthetic, attachmentPath: `closes/${account.code}/${ym}/fechamento-${account.code}-${ym}.pdf` });
}

/**
 * C09 "Gerar fechamento mensal": status computed, P06 and xlsx rendered by worker-render (render_close),
 * and close_ready queued when the 5th of the next month has come (04 §9); before that the day-5 schedule
 * sends it (Vercel Cron, not built in wave 1).
 */
export async function generateClose(
  db: Db,
  account: M2Account,
  close: ClosePeriod,
  staffId: string,
  now: Date,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ notified: boolean }> {
  const { error } = await db.from("close_period").update({ status: "computed", computed_at: now.toISOString() }).eq("id", close.id);
  if (error) throw new Error(error.message);
  await enqueueJob(enqueueDeps(), { type: "render_close", payload: { close_period_id: close.id }, accountId: account.id, dedupeKey: `render_close:${close.id}` });
  const y = Number(close.month.slice(0, 4));
  const m = Number(close.month.slice(5, 7));
  const fifth = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 5, 3));
  let notified = false;
  if (now >= fifth) {
    await notify(
      { store: new SupabaseNotifyStore(db), now: () => now },
      { code: "close_ready", accountId: account.id, message: await closeReadyMessage(db, account, close) },
    );
    notified = true;
  }
  await audit(db, {
    actor: staffId,
    accountId: account.id,
    action: "close_period.generate",
    entity: "close_period",
    entityId: close.id,
    before: { status: close.status },
    after: { status: "computed", notified },
    meta,
  });
  return { notified };
}
