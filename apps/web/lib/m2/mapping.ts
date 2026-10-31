// C17 Corrigir importação (design/C17-CorrigirImport.dc.html, 05 §A, 04 §11): the columns of a file whose
// layout has no saved column_mapping, what each becomes, and the payout check. worker-import wrote the
// proposal and the check into import_run.log; saving writes column_mapping for the file signature and
// requeues the run, where the worker checks the payout total again (the run fails if it does not match).
import type { Json } from "@margoai/contracts";
import type { Db } from "@/lib/supabase/admin";
import { audit, type M2Account } from "./account";
import { brlCents, type Channel } from "./format";
import { ImportRefused, queueRun } from "./imports";

/** Canonical fields, the same keys and labels as FIELDS in workers/import/src/margo_import/layout.py. */
export const FIELDS: Record<string, string> = {
  order_id: "pedido",
  store_id: "loja",
  cnpj: "CNPJ",
  ordered_at: "data do pedido",
  status: "situação do pedido",
  cancelled_by: "cancelado por",
  cancel_reason: "motivo do cancelamento",
  gross: "venda bruta",
  items: "valor dos itens",
  delivery_fee: "taxa de entrega do cliente",
  items_text: "itens do pedido",
  discount_channel: "promoção paga pelo app",
  commission: "comissão",
  payment_fee: "taxa de pagamento",
  delivery: "entrega",
  promotion: "promoção paga pela loja",
  anticipation: "antecipação",
  refund: "reembolso",
  cancellation: "cancelamento",
  adjustment: "ajuste",
  tax: "imposto retido",
  payout: "repasse",
  payout_date: "data do repasse",
  expected_payment_date: "data prevista do repasse",
  installment: "parcela do repasse",
  transaction_id: "id da transação",
};
export const IGNORE = "ignorar";
export const REQUIRED = ["order_id", "store_id", "ordered_at", "gross", "payout"];

export interface FileColumn {
  name: string;
  example: string;
  field: string | null;
  known: boolean;
}

export interface MappingLog {
  signature: string;
  columns: FileColumn[];
  proposal: { columns: Record<string, string>; decimal: string; date_format: string };
  rows_in_file: number;
  payout_total_file_cents: number | null;
  payout_total_mapped_cents: number | null;
}

export function readLog(log: Json): MappingLog | null {
  if (!log || typeof log !== "object" || Array.isArray(log)) return null;
  const l = log as unknown as MappingLog;
  return typeof l.signature === "string" && Array.isArray(l.columns) ? l : null;
}

/** C17 check block: "R$ 14.471,00 · bate", or the gap. */
export function checkLine(l: MappingLog): { file: string; mapped: string; ok: boolean } {
  const file = l.payout_total_file_cents;
  const mapped = l.payout_total_mapped_cents;
  if (file === null || mapped === null) return { file: file === null ? "" : brlCents(file), mapped: "falta o campo repasse", ok: false };
  const ok = file === mapped;
  return { file: brlCents(file), mapped: ok ? `${brlCents(mapped)} · bate` : `${brlCents(mapped)} · não bate (${brlCents(mapped - file)})`, ok };
}

/** "Situação": conhecida, or "nova: confirmar" until someone decides. */
export const columnStatus = (c: FileColumn) => (c.known ? "conhecida" : "nova: confirmar");

/** The mapping the form submits, checked: every new column decided, the required fields present. */
export function mappingFromForm(l: MappingLog, form: FormData): { columns: Record<string, string>; missing: string[]; undecided: string[] } {
  const columns: Record<string, string> = {};
  const undecided: string[] = [];
  l.columns.forEach((c, i) => {
    const v = String(form.get(`col-${i}`) ?? "");
    if (v === IGNORE || v in FIELDS) columns[c.name] = v;
    else if (!c.known) undecided.push(c.name);
    else if (c.field) columns[c.name] = c.field;
  });
  const chosen = new Set(Object.values(columns));
  return { columns, missing: REQUIRED.filter((f) => !chosen.has(f)).map((f) => FIELDS[f]), undecided };
}

export interface CorrectionRun {
  id: string;
  accountId: string;
  channel: Channel;
  fileName: string;
  status: string;
  log: MappingLog | null;
}

export async function loadCorrection(db: Db, runId: string): Promise<CorrectionRun | null> {
  if (!/^[0-9a-f-]{36}$/.test(runId)) return null;
  const { data, error } = await db.from("import_run").select("id, account_id, channel, file_name, status, log").eq("id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id, accountId: data.account_id, channel: data.channel, fileName: data.file_name ?? "", status: data.status, log: readLog(data.log) };
}

/** "Salvar e reprocessar": refused unless the check bates and every new column has a decision. */
export async function saveMapping(
  db: Db,
  account: M2Account,
  run: CorrectionRun,
  staffId: string,
  form: FormData,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const l = run.log;
  if (run.status !== "needs_mapping" || !l) throw new ImportRefused("Esta importação não espera mapeamento.");
  if (!checkLine(l).ok) throw new ImportRefused("A soma do repasse não bate. Confira a coluna do repasse antes de salvar.");
  const { columns, missing, undecided } = mappingFromForm(l, form);
  if (undecided.length) throw new ImportRefused(`Diga o que significa: ${undecided.join(", ")}.`);
  if (missing.length) throw new ImportRefused(`Faltam os campos: ${missing.join(", ")}.`);
  const mapping = { columns, decimal: l.proposal.decimal, date_format: l.proposal.date_format };
  const name = `${run.fileName} (C17)`;
  const { data: saved, error } = await db
    .from("column_mapping")
    .upsert({ channel: run.channel, file_signature: l.signature, name, mapping, created_by: staffId }, { onConflict: "channel,file_signature" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const upd = await db.from("import_run").update({ mapping_id: saved.id }).eq("id", run.id);
  if (upd.error) throw new Error(upd.error.message);
  await queueRun(db, account, run.id, run.channel);
  await audit(db, {
    actor: staffId,
    accountId: account.id,
    action: "column_mapping.save",
    entity: "column_mapping",
    entityId: saved.id,
    after: { signature: l.signature, columns, import_run_id: run.id },
    meta,
  });
}
