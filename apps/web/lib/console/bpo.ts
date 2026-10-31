// C18 Parceiros BPO (design/C18-BPO.dc.html, 05 §A, 04 §5, §6): partners with their clients, folder status,
// price per store (Fundador only), the brand on P06, and "Gerar fechamento com a marca do BPO". Copy verbatim
// from the drawing; what the drawing does not show is marked and listed for Marlon.
import { isEnabled } from "@/lib/flags";
import { plural } from "@/lib/format";
import { brlCents } from "@/lib/m2/format";
import type { Db } from "@/lib/supabase/admin";

const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthOf = (iso: string) => MON[Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", month: "numeric" }).format(new Date(iso))) - 1];

export interface PartnerRecord {
  id: string;
  name: string;
  folder_url: string | null;
  logo_path: string | null;
  primary_color: string | null;
  show_powered_by: boolean;
  price_per_store_cents: number | null;
  pipeline_note: string | null;
  updated_at: string;
}

export interface PartnerFacts {
  clients: number;
  stores: number;
  /** created_at of the newest import from the partner's folder, any client. */
  lastFolderFile: string | null;
}

export interface PartnerRow {
  id: string;
  name: string;
  clients: string;
  folder: { text: string; ok: boolean };
  price: string;
}

/** C18 table row, as drawn: "2 grupos · 7 lojas", "arquivos de out chegaram", "[a definir]". */
export function partnerRow(p: PartnerRecord, f: PartnerFacts): PartnerRow {
  const clients = f.clients
    ? `${plural(f.clients, "grupo", "grupos")} · ${plural(f.stores, "loja", "lojas")}`
    : // Not drawn: a partner without clients and without a note.
      (p.pipeline_note ?? "nenhum cliente ainda");
  let folder: PartnerRow["folder"];
  if (!p.folder_url) folder = { text: "não criada", ok: false };
  else if (f.lastFolderFile) folder = { text: `arquivos de ${monthOf(f.lastFolderFile)} chegaram`, ok: true };
  // Not drawn: folder created, nothing arrived yet.
  else folder = { text: "criada, sem arquivos", ok: false };
  return { id: p.id, name: p.name, clients, folder, price: p.price_per_store_cents === null ? "[a definir]" : brlCents(p.price_per_store_cents) };
}

/** "#1351B4": the brand color as saved; anything else is refused. */
export const isHexColor = (s: string) => /^#[0-9A-Fa-f]{6}$/.test(s);

const PNG = [0x89, 0x50, 0x4e, 0x47];

/** C18 "Logo do BPO (PNG ou SVG)", up to 512 KB. Returns the extension, or null when it is neither. */
export function logoKind(name: string, bytes: Uint8Array): "png" | "svg" | null {
  if (bytes.length === 0 || bytes.length > 512 * 1024) return null;
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "png" && PNG.every((b, i) => bytes[i] === b)) return "png";
  if (ext === "svg" && /<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0, 2048)))) return "svg";
  return null;
}

const PARTNER_COLUMNS = "id, name, folder_url, logo_path, primary_color, show_powered_by, price_per_store_cents, pipeline_note, updated_at";

export async function loadPartners(db: Db) {
  const [{ data: partners, error }, { data: clients }] = await Promise.all([
    db.from("bpo_partner").select(PARTNER_COLUMNS).order("name"),
    db.from("bpo_client").select("bpo_partner_id, account_id, account(name, code, is_synthetic)"),
  ]);
  if (error) throw new Error(error.message);
  const accountIds = [...new Set((clients ?? []).map((c) => c.account_id))];
  const [{ data: stores }, { data: folderRuns }] = await Promise.all([
    accountIds.length ? db.from("channel_store").select("account_id").in("account_id", accountIds) : Promise.resolve({ data: [] as { account_id: string }[] }),
    accountIds.length
      ? db.from("import_run").select("account_id, created_at, import_source!inner(kind)").in("account_id", accountIds).eq("import_source.kind", "bpo_folder").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { account_id: string; created_at: string }[] }),
  ]);
  return (partners ?? []).map((p) => {
    const mine = (clients ?? []).filter((c) => c.bpo_partner_id === p.id);
    const ids = new Set(mine.map((c) => c.account_id));
    const facts: PartnerFacts = {
      clients: mine.length,
      stores: (stores ?? []).filter((s) => ids.has(s.account_id)).length,
      lastFolderFile: (folderRuns ?? []).find((r) => ids.has(r.account_id))?.created_at ?? null,
    };
    return {
      record: p as PartnerRecord,
      row: partnerRow(p as PartnerRecord, facts),
      clients: mine.map((c) => ({ accountId: c.account_id, name: c.account?.name ?? "", code: c.account?.code ?? "", synthetic: c.account?.is_synthetic ?? false })),
    };
  });
}

export type LoadedPartner = Awaited<ReturnType<typeof loadPartners>>[number];

/**
 * A05: C18 is behind bpo.marca_propria, which is per account (off in every plan, 04 §6). The screen shows
 * when the flag is on for at least one BPO client account (decision listed for Marlon).
 */
export async function bpoScreenEnabled(partners: LoadedPartner[]): Promise<boolean> {
  for (const p of partners) for (const c of p.clients) if (await isEnabled("bpo.marca_propria", c.accountId)) return true;
  return false;
}

export interface BrandedClose {
  jobId: string;
  account: string;
  month: string;
  status: string;
  ready: boolean;
}

/** The branded closes asked for this partner, newest first (render_close_bpo jobs). */
export async function loadBrandedCloses(db: Db, partnerId: string): Promise<BrandedClose[]> {
  const { data, error } = await db
    .from("job")
    .select("id, status, payload, created_at")
    .eq("type", "render_close_bpo")
    .contains("payload", { bpo_partner_id: partnerId })
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  const closeIds = (data ?? []).map((j) => String((j.payload as Record<string, unknown>).close_period_id));
  const { data: closes } = closeIds.length ? await db.from("close_period").select("id, month, account(name, code)").in("id", closeIds) : { data: [] };
  const byId = new Map((closes ?? []).map((c) => [c.id, c]));
  const STATUS: Record<string, string> = { queued: "na fila", running: "gerando", done: "pronto", failed: "falhou" };
  return (data ?? []).map((j) => {
    const c = byId.get(String((j.payload as Record<string, unknown>).close_period_id));
    return {
      jobId: j.id,
      account: c?.account ? `${c.account.name} (${c.account.code})` : "",
      month: c ? `${MON[Number(c.month.slice(5, 7)) - 1]}/${c.month.slice(0, 4)}` : "",
      status: STATUS[j.status] ?? j.status,
      ready: j.status === "done",
    };
  });
}

/** closes/bpo/<partner>/<code>/<yyyy-mm>/fechamento-<code>-<yyyy-mm>.pdf (workers/render bpo.py). */
export const bpoPdfPath = (partnerId: string, code: string, ym: string) => `bpo/${partnerId}/${code}/${ym}/fechamento-${code}-${ym}.pdf`;
