// C10 Notas de compra (design/C10-Notas.dc.html, 05 §A, 06 §5, D11, D13). Copy verbatim from the drawing.
// The accountant's zip goes to the invoices bucket and worker-import (job import_invoice_zip, flag
// m3.notas_xml); a single receipt is a typed key or a QR link, checked (mod 11) before anything is saved,
// whose item lines a founder types from the state's public page (V1).
import { dayMon } from "@/lib/m2/format";
import { audit, type M2Account } from "@/lib/m2/account";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { enqueueDeps } from "@/lib/jobs/deps";
import type { Db } from "@/lib/supabase/admin";
import { unitPriceLabel, type BaseUnit } from "./format";
import { keyFromInput, keyIssuer, keyModel, keyMonthStart } from "./keys";
import { invoiceRequestText, shortName, whatsappTextLink } from "./P05-whatsapp-nota";

type Meta = { ip: string | null; userAgent: string | null };

export class NotasRefused extends Error {}

// Zip stats -------------------------------------------------------------------------------------------

export interface ImportRecord {
  id: string;
  status: "queued" | "running" | "ok" | "failed" | "needs_mapping";
  invoices_new: number | null;
  months_count: number | null;
  suppliers_count: number | null;
  nfe_count: number | null;
  nfce_count: number | null;
  duplicates: number | null;
  log: unknown;
}

const REASON: Record<string, string> = {
  not_zip: "o arquivo não é um .zip",
  no_owner_authorization: "falta a autorização do dono para notas",
  source_paused: "importações pausadas para esta conta",
  file_missing: "arquivo não encontrado",
  too_many_files: "arquivos demais no .zip",
};

/** "312 notas · 12 meses · 41 fornecedores" and "NF-e: 268 · NFC-e: 44 · duplicadas: 9", or the run state. */
export function zipStatsLines(r: ImportRecord | null): string[] {
  if (!r) return ["Nenhum .zip importado ainda."];
  if (r.status === "queued" || r.status === "running") return ["Importando o .zip..."];
  if (r.status !== "ok") {
    const reason = (r.log as { reason?: string } | null)?.reason ?? "";
    return [`A importação falhou: ${REASON[reason] ?? reason}.`];
  }
  const n = (v: number | null) => v ?? 0;
  return [
    `${n(r.invoices_new)} notas · ${n(r.months_count)} meses · ${n(r.suppliers_count)} fornecedores`,
    `NF-e: ${n(r.nfe_count)} · NFC-e: ${n(r.nfce_count)} · duplicadas: ${n(r.duplicates)}`,
  ];
}

export async function latestImport(db: Db, accountId: string): Promise<ImportRecord | null> {
  const { data, error } = await db
    .from("invoice_import")
    .select("id, status, invoices_new, months_count, suppliers_count, nfe_count, nfce_count, duplicates, log")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Coverage of the top 20 insumos and P05 ---------------------------------------------------------------

export interface TopIngredient {
  id: string;
  name: string;
  short_name: string | null;
  base_unit: BaseUnit;
  /** CST-01: latest confirmed invoice price in the window, or null. */
  price: { centsPerBase: number; observedOn: string; model: number } | null;
}

export interface CoverageRow {
  name: string;
  price: string;
  source: string;
  covered: boolean;
}

export interface Coverage {
  rows: CoverageRow[];
  covered: number;
  total: number;
  missing: string[];
  /** P05 click-to-chat, only when something is missing. */
  whatsapp: string | null;
}

/** C10 coverage: "16 de 20", priced rows first ("nota de 12/out", "cupom de 03/out"), then "falta nota". */
export function coverage(top: TopIngredient[]): Coverage {
  const covered = top.filter((t) => t.price);
  const missing = top.filter((t) => !t.price);
  const rows: CoverageRow[] = [
    ...covered.map((t) => ({
      name: t.name,
      price: unitPriceLabel(t.price!.centsPerBase, t.base_unit),
      source: `${t.price!.model === 65 ? "cupom" : "nota"} de ${dayMon(t.price!.observedOn)}`,
      covered: true,
    })),
    ...missing.map((t) => ({ name: t.name, price: "sem preço", source: "falta nota", covered: false })),
  ];
  const names = missing.map(shortName);
  return { rows, covered: covered.length, total: top.length, missing: names, whatsapp: names.length ? whatsappTextLink(invoiceRequestText(names)) : null };
}

/** "Faltam 4 insumos." */
export const missingLine = (n: number) => (n === 0 ? "Nenhum insumo faltando." : n === 1 ? "Falta 1 insumo." : `Faltam ${n} insumos.`);

// Writes (audited, A04) -------------------------------------------------------------------------------

/** C06, 04 §11 for a real account: some company must have an owner_authorization covering invoices. */
async function requireAuthorization(db: Db, account: M2Account, companyId?: string): Promise<void> {
  if (account.isSynthetic) return;
  let q = db.from("owner_authorization").select("id", { count: "exact", head: true }).eq("account_id", account.id).contains("scope", ["notas"]);
  if (companyId) q = q.eq("company_id", companyId);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  if (!count) throw new NotasRefused("Sem autorização do dono para notas deste CNPJ. A importação espera a autorização assinada.");
}

/** "Pasta do contador": store the zip, create the invoice_import run and its job (worker-import). */
export async function uploadZip(db: Db, account: M2Account, staffId: string, file: File, meta: Meta): Promise<string> {
  await requireAuthorization(db, account);
  if (!file.name.toLowerCase().endsWith(".zip")) throw new NotasRefused("O arquivo precisa ser um .zip.");
  const id = crypto.randomUUID();
  const name = file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_");
  const objectPath = `${account.id}/zips/${id}/${name}`;
  const up = await db.storage.from("invoices").upload(objectPath, new Uint8Array(await file.arrayBuffer()), { contentType: "application/zip" });
  if (up.error) throw new Error(up.error.message);
  const ins = await db.from("invoice_import").insert({ id, account_id: account.id, file_path: `invoices/${objectPath}`, file_name: name, created_by: staffId });
  if (ins.error) throw new Error(ins.error.message);
  const job = await enqueueJob(enqueueDeps(), { type: "import_invoice_zip", payload: { invoice_import_id: id }, accountId: account.id, dedupeKey: `invoice_import:${id}` });
  const upd = await db.from("invoice_import").update({ job_id: job.jobId }).eq("id", id);
  if (upd.error) throw new Error(upd.error.message);
  await audit(db, { actor: staffId, accountId: account.id, action: "invoice_import.upload", entity: "invoice_import", entityId: id, after: { file_name: name }, meta });
  return id;
}

/** "Cupom avulso": a typed key or QR link, check digit verified before saving (05 C10 "Done when"). The
 * invoice starts without lines: issuer and model come from the key, the date is the key's month until the
 * founder types the date and items from the state's public page (D13). */
export async function saveKey(db: Db, account: M2Account, staffId: string, input: string, meta: Meta): Promise<string> {
  const parsed = keyFromInput(input);
  if (!parsed) throw new NotasRefused("Chave inválida: confira os 44 dígitos ou o link do QR code.");
  const { data: companies, error: ce } = await db.from("company").select("id").eq("account_id", account.id);
  if (ce) throw new Error(ce.message);
  if (companies?.length !== 1) throw new NotasRefused("Esta conta tem mais de uma empresa: importe o .zip do contador.");
  const companyId = companies[0].id;
  await requireAuthorization(db, account, companyId);
  const { data: known } = await db.from("invoice").select("id").eq("access_key", parsed.key).maybeSingle();
  if (known) throw new NotasRefused("Esta nota já está salva.");
  const { data, error } = await db
    .from("invoice")
    .insert({
      account_id: account.id,
      company_id: companyId,
      access_key: parsed.key,
      model: keyModel(parsed.key),
      issuer_cnpj: keyIssuer(parsed.key),
      issued_at: keyMonthStart(parsed.key),
      total_cents: 0,
      source: parsed.source,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await audit(db, { actor: staffId, accountId: account.id, action: "invoice.key_saved", entity: "invoice", entityId: data.id, after: { source: parsed.source, model: keyModel(parsed.key) }, meta });
  return data.id;
}

export interface KeyedReceipt {
  id: string;
  key: string;
  model: number;
  issuedOn: string;
  lines: { description: string; qty: number; unit: string; total_cents: number }[];
}

/** Receipts saved from a key or QR link in the last 30 days, with the lines typed so far. */
export async function keyedReceipts(db: Db, accountId: string): Promise<KeyedReceipt[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("invoice")
    .select("id, access_key, model, issued_at, invoice_line(description, qty, unit, total_cents, line_no)")
    .eq("account_id", accountId)
    .in("source", ["key_typed", "qr_url"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    key: r.access_key,
    model: r.model,
    issuedOn: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(r.issued_at)),
    lines: [...r.invoice_line].sort((a, b) => a.line_no - b.line_no).map((l) => ({ description: l.description, qty: Number(l.qty), unit: l.unit, total_cents: l.total_cents })),
  }));
}

/** "R$ 12,34" or "12,34" to centavos; null when not a positive amount. */
export function parseReais(raw: string): number | null {
  const s = raw.replace(/R\$\s*/i, "").trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}

export interface TypedLine {
  issuedOn: string;
  description: string;
  unit: string;
  qty: string;
  total: string;
}

/** One item line typed from the state's public page; the invoice total and date follow; match job queued. */
export async function addKeyedLine(db: Db, account: M2Account, staffId: string, invoiceId: string, l: TypedLine, meta: Meta): Promise<void> {
  const { data: inv, error } = await db.from("invoice").select("id, source, total_cents, invoice_line(line_no)").eq("id", invoiceId).eq("account_id", account.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv || inv.source === "xml_zip") throw new NotasRefused("Nota não encontrada.");
  const qty = Number(l.qty.replace(",", "."));
  const total = parseReais(l.total);
  const description = l.description.trim().toUpperCase();
  const unit = l.unit.trim().toUpperCase();
  if (!description || !unit || !(qty > 0) || total === null || !/^\d{4}-\d{2}-\d{2}$/.test(l.issuedOn)) {
    throw new NotasRefused("Preencha data, descrição, unidade, quantidade e valor do item.");
  }
  const lineNo = Math.max(0, ...inv.invoice_line.map((x) => x.line_no)) + 1;
  const ins = await db.from("invoice_line").insert({
    account_id: account.id,
    invoice_id: inv.id,
    line_no: lineNo,
    description,
    unit,
    qty,
    unit_price_cents: Math.round(total / qty),
    total_cents: total,
  });
  if (ins.error) throw new Error(ins.error.message);
  const upd = await db.from("invoice").update({ total_cents: inv.total_cents + total, issued_at: `${l.issuedOn}T12:00:00-03:00` }).eq("id", inv.id);
  if (upd.error) throw new Error(upd.error.message);
  await enqueueJob(enqueueDeps(), { type: "match_ai", payload: { account_id: account.id }, accountId: account.id, dedupeKey: `match_ai:${account.id}` });
  await audit(db, { actor: staffId, accountId: account.id, action: "invoice_line.typed", entity: "invoice", entityId: inv.id, after: { line_no: lineNo, total_cents: total }, meta });
}
