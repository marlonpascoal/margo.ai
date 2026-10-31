// C07 Conectar e importar (design/C07-Conectar.dc.html, 05 §A, 04 §11, D31): source cards and the import
// history, and the file upload that creates an import_run and a job. Copy verbatim from the drawing.
import type { Database, Json } from "@margoai/contracts";
import { dayMonth, TIME_ZONE } from "@/lib/format";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { enqueueDeps } from "@/lib/jobs/deps";
import type { Db } from "@/lib/supabase/admin";
import { audit, FILE_JOB, type M2Account } from "./account";
import { CHANNEL_LABEL, count, durationLabel, periodLabel, plural, type Channel } from "./format";

type ImportStatus = Database["public"]["Enums"]["import_status"];
type ImportTrigger = Database["public"]["Enums"]["import_trigger"];
type ImportKind = Database["public"]["Enums"]["import_kind"];

export const PAGE_SIZE = 8;

export interface RunRecord {
  id: string;
  created_at: string;
  trigger: ImportTrigger;
  channel: Channel;
  store_ids: string[];
  period_start: string | null;
  period_end: string | null;
  file_path: string | null;
  file_name: string | null;
  rows_total: number | null;
  duration_ms: number | null;
  status: ImportStatus;
  log: Json;
  source_kind: ImportKind | null;
  created_by_name: string | null;
}

export type Tone = "ok" | "run" | "warn" | "bad";

export interface RunRow {
  id: string;
  when: string;
  trigger: string;
  source: string;
  stores: string;
  period: string;
  rows: string;
  duration: string;
  status: string;
  tone: Tone;
  action: { label: string; href?: string; rerun?: boolean } | null;
  log: string;
}

const hm = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, dateStyle: "short" }).format(d);

/** "hoje 06:00", "ontem 21:14", "28/out 15:02" (as drawn). */
export function whenLabel(at: Date, now: Date): string {
  if (dayKey(at) === dayKey(now)) return `hoje ${hm(at)}`;
  if (dayKey(at) === dayKey(new Date(now.getTime() - 86_400_000))) return `ontem ${hm(at)}`;
  return `${dayMonth(at)} ${hm(at)}`;
}

/** "Disparo": agendado, extensão, upload (Manuel), pasta do BPO, rodar de novo. */
export function triggerLabel(r: Pick<RunRecord, "trigger" | "source_kind" | "created_by_name">): string {
  if (r.trigger === "schedule") return "agendado";
  if (r.trigger === "extension") return "extensão";
  if (r.trigger === "rerun") return r.created_by_name ? `rodar de novo (${r.created_by_name})` : "rodar de novo";
  if (r.trigger === "manual") return "manual";
  if (r.source_kind === "bpo_folder") return "pasta do BPO";
  if (r.source_kind === "whatsapp") return "WhatsApp";
  return r.created_by_name ? `upload (${r.created_by_name})` : "upload";
}

const logObject = (log: Json): Record<string, Json | undefined> => (log && typeof log === "object" && !Array.isArray(log) ? log : {});

/** Failure reasons of worker-import, said for the founders. */
export const REASON_LABEL: Record<string, string> = {
  token_expired: "token expirado",
  payout_total_mismatch: "repasse não bate",
  unknown_store: "loja desconhecida",
  no_owner_authorization: "sem autorização do dono",
  unreadable: "arquivo ilegível",
  bad_value: "valor ilegível",
  file_missing: "arquivo sumiu",
  wrong_channel: "canal errado",
  error: "erro",
};

export function statusLabel(r: Pick<RunRecord, "status" | "log">): { text: string; tone: Tone } {
  const log = logObject(r.log);
  if (r.status === "ok") return { text: "importado", tone: "ok" };
  if (r.status === "running") return { text: log.progress != null ? `rodando ${log.progress}%` : "rodando", tone: "run" };
  if (r.status === "queued") return { text: "na fila", tone: "run" };
  if (r.status === "needs_mapping") {
    const cols = Array.isArray(log.columns) ? log.columns.filter((c) => c && typeof c === "object" && !Array.isArray(c) && c.known === false).length : 0;
    return { text: plural(cols, "coluna nova", "colunas novas"), tone: "warn" };
  }
  const reason = typeof log.reason === "string" ? (REASON_LABEL[log.reason] ?? log.reason) : "erro";
  return { text: `falhou: ${reason}`, tone: "bad" };
}

/** "Canal e fonte": "iFood · API conciliação", "99Food · extrato.xlsx". */
export function sourceLabel(r: Pick<RunRecord, "channel" | "file_name" | "log">): string {
  const log = logObject(r.log);
  const what = typeof log.source === "string" ? log.source : (r.file_name ?? "");
  return `${CHANNEL_LABEL[r.channel]} · ${what}`;
}

export function buildRunRows(runs: RunRecord[], now: Date): RunRow[] {
  return runs.map((r) => {
    const st = statusLabel(r);
    let action: RunRow["action"] = null;
    if (r.status === "needs_mapping") action = { label: "corrigir", href: `/console/importacoes/${r.id}/corrigir` };
    else if (r.status === "failed") action = { label: "rodar de novo", rerun: !!r.file_path };
    else if (r.status === "running" || r.status === "queued") action = { label: "acompanhar" };
    else action = { label: "ver log" };
    const log = logObject(r.log);
    const facts = [
      typeof log.mapping === "string" ? `layout ${log.mapping}` : null,
      typeof log.canonical_new === "number" ? `${log.canonical_new} linhas canônicas novas` : null,
      typeof log.reason === "string" ? `motivo: ${log.reason}` : null,
    ].filter(Boolean);
    return {
      id: r.id,
      when: whenLabel(new Date(r.created_at), now),
      trigger: triggerLabel(r),
      source: sourceLabel(r),
      stores: String(r.store_ids.length),
      period: periodLabel(r.period_start, r.period_end),
      rows: r.rows_total === null ? "" : count(r.rows_total),
      duration: durationLabel(r.duration_ms),
      status: st.text,
      tone: st.tone,
      action,
      log: facts.join(" · "),
    };
  });
}

export interface ImportFilters {
  channel: Channel | null;
  errorsOnly: boolean;
  page: number;
}

export function parseFilters(q: { canal?: string; situacao?: string; pagina?: string }): ImportFilters {
  const channel = q.canal === "ifood" || q.canal === "food99" ? q.canal : null;
  const page = Math.max(1, Number.parseInt(q.pagina ?? "1", 10) || 1);
  return { channel, errorsOnly: q.situacao === "erro", page };
}

export interface SourceCards {
  queue: { running: number; queued: number };
  api: { stores: number; lastOk: string | null } | null;
  extension: { lastOk: string | null; stale: boolean } | null;
}

export async function loadImports(db: Db, account: M2Account, f: ImportFilters) {
  let q = db
    .from("import_run")
    .select("id, created_at, trigger, channel, store_ids, period_start, period_end, file_path, file_name, rows_total, duration_ms, status, log, import_source(kind), person!import_run_created_by_fkey(name)", { count: "exact" })
    .eq("account_id", account.id);
  if (f.channel) q = q.eq("channel", f.channel);
  if (f.errorsOnly) q = q.in("status", ["failed", "needs_mapping"]);
  const from = (f.page - 1) * PAGE_SIZE;
  const { data, count: total, error } = await q.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  const runs: RunRecord[] = (data ?? []).map((r) => ({
    ...r,
    store_ids: r.store_ids ?? [],
    source_kind: r.import_source?.kind ?? null,
    created_by_name: r.person?.name ?? null,
  }));
  const [{ data: first }, { data: queue }, { data: sources }, { data: stores }] = await Promise.all([
    db.from("import_run").select("created_at").eq("account_id", account.id).order("created_at").limit(1),
    db.from("import_run").select("status").eq("account_id", account.id).in("status", ["running", "queued"]),
    db.from("import_source").select("channel, kind, last_ok_at, stale_after_hours").eq("account_id", account.id),
    db.from("channel_store").select("id, channel, authorized").eq("account_id", account.id),
  ]);
  const api = sources?.find((s) => s.channel === "ifood" && s.kind === "api");
  const ext = sources?.find((s) => s.channel === "ifood" && s.kind === "extension");
  const now = Date.now();
  const cards: SourceCards = {
    queue: {
      running: (queue ?? []).filter((r) => r.status === "running").length,
      queued: (queue ?? []).filter((r) => r.status === "queued").length,
    },
    api: api ? { stores: (stores ?? []).filter((s) => s.channel === "ifood" && s.authorized).length, lastOk: api.last_ok_at } : null,
    extension: ext
      ? {
          lastOk: ext.last_ok_at,
          stale: !ext.last_ok_at || now - new Date(ext.last_ok_at).getTime() > (ext.stale_after_hours ?? 72) * 3_600_000,
        }
      : null,
  };
  return {
    runs,
    total: total ?? 0,
    since: first?.[0]?.created_at ?? null,
    cards,
    storeCount: stores?.length ?? 0,
  };
}

/** "Mostrando 8 de 214 importações desde 10/out." */
export function countLine(shown: number, total: number, since: string | null): string {
  const tail = since ? ` desde ${dayMonth(new Date(since))}` : "";
  return `Mostrando ${shown} de ${count(total)} importações${tail}. Uma linha repetida em duas importações conta uma vez só.`;
}

// Writes ----------------------------------------------------------------------------------------------

export class ImportRefused extends Error {}

const CONTENT_TYPE: Record<string, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function sourceId(db: Db, accountId: string, channel: Channel): Promise<string> {
  const { data, error } = await db
    .from("import_source")
    .upsert({ account_id: accountId, channel, kind: "upload" }, { onConflict: "account_id,channel,kind", ignoreDuplicates: false })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function queueRun(db: Db, account: M2Account, runId: string, channel: Channel): Promise<void> {
  const type = FILE_JOB[channel];
  if (!type) throw new ImportRefused("canal sem importação por arquivo");
  const job = await enqueueJob(enqueueDeps(), { type, payload: { import_run_id: runId }, accountId: account.id, dedupeKey: `import_run:${runId}` });
  const { error } = await db.from("import_run").update({ job_id: job.jobId, status: "queued" }).eq("id", runId);
  if (error) throw new Error(error.message);
}

/**
 * C07 drop zone: store the file, create the import_run and its job (D31: same queue as every source).
 * C06, 04 §11: a real account with no owner_authorization at all is refused here; the worker checks each
 * CNPJ of the file.
 */
export async function uploadFile(
  db: Db,
  account: M2Account,
  staffId: string,
  channel: Channel,
  file: File,
  meta: { ip: string | null; userAgent: string | null },
): Promise<string> {
  if (!account.isSynthetic) {
    const { count: n } = await db.from("owner_authorization").select("id", { count: "exact", head: true }).eq("account_id", account.id);
    if (!n) throw new ImportRefused("Sem autorização do dono para este CNPJ. A importação espera a autorização assinada.");
  }
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!CONTENT_TYPE[ext]) throw new ImportRefused("Arquivo precisa ser .csv ou .xlsx.");
  const id = crypto.randomUUID();
  const name = file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_");
  const objectPath = `${account.code}/${id}/${name}`;
  const up = await db.storage.from("imports").upload(objectPath, new Uint8Array(await file.arrayBuffer()), { contentType: CONTENT_TYPE[ext] });
  if (up.error) throw new Error(up.error.message);
  const { error } = await db.from("import_run").insert({
    id,
    account_id: account.id,
    source_id: await sourceId(db, account.id, channel),
    trigger: "upload",
    channel,
    file_path: `imports/${objectPath}`,
    file_name: name,
    created_by: staffId,
  });
  if (error) throw new Error(error.message);
  await queueRun(db, account, id, channel);
  await audit(db, { actor: staffId, accountId: account.id, action: "import_run.upload", entity: "import_run", entityId: id, after: { channel, file_name: name }, meta });
  return id;
}

/** "rodar de novo": a new run of the same stored file (trigger rerun); the history keeps both. */
export async function rerunImport(db: Db, account: M2Account, staffId: string, runId: string, meta: { ip: string | null; userAgent: string | null }): Promise<string> {
  const { data: run, error } = await db.from("import_run").select("id, channel, file_path, file_name, source_id").eq("id", runId).eq("account_id", account.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!run?.file_path) throw new ImportRefused("Só um arquivo pode rodar de novo.");
  const id = crypto.randomUUID();
  const ins = await db.from("import_run").insert({
    id,
    account_id: account.id,
    source_id: run.source_id,
    trigger: "rerun",
    channel: run.channel,
    file_path: run.file_path,
    file_name: run.file_name,
    created_by: staffId,
  });
  if (ins.error) throw new Error(ins.error.message);
  await queueRun(db, account, id, run.channel);
  await audit(db, { actor: staffId, accountId: account.id, action: "import_run.rerun", entity: "import_run", entityId: id, before: { from: runId }, meta });
  return id;
}

export { queueRun };
