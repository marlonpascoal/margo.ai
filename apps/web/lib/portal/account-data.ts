// E06 from the portal side (05 W09, 02 §7, D48): queue the data export and the account deletion, and
// serve files to the people allowed to read them. The W09 buttons ("Baixar todos os meus dados",
// "Excluir a conta e os dados", code confirmation) belong to the Segurança page; they call these.
import { enqueueJob, type EnqueueDeps } from "@/lib/jobs/enqueue";
import { notify, type NotifyDeps } from "@/lib/notify/outbox";
import type { Db } from "@/lib/supabase/admin";
import { seesKitchen, type Scope } from "./scope";

export interface Requester {
  personId: string;
  personName: string;
  accountId: string;
  accountName: string;
  meta: { ip: string | null; userAgent: string | null };
}

async function audit(db: Db, who: Requester, action: string, entityId: string, after: Record<string, unknown>) {
  const { error } = await db.from("audit_log").insert({
    actor_person_id: who.personId,
    actor_kind: "person",
    account_id: who.accountId,
    action,
    entity: "job",
    entity_id: entityId,
    after: after as never,
    ip: who.meta.ip,
    user_agent: who.meta.userAgent,
  });
  if (error) throw new Error(error.message);
}

/** "Baixar todos os meus dados": worker-account builds the zip (job account_export). Dono only. */
export async function requestExport(db: Db, deps: EnqueueDeps, who: Requester): Promise<string> {
  const job = await enqueueJob(deps, {
    type: "account_export",
    payload: { account_id: who.accountId, requested_by: who.personId },
    accountId: who.accountId,
    dedupeKey: `account_export:${who.accountId}`,
  });
  await audit(db, who, "account.export_requested", job.jobId, { deduped: job.deduped });
  return job.jobId;
}

/**
 * "Excluir a conta e os dados" after the code confirmation: queues account_delete (job.account_id null, so
 * the job row outlives the account) and confirms by e-mail to every Dono (security_event, e-mail locked).
 */
export async function requestDeletion(db: Db, deps: { enqueue: EnqueueDeps; notify: NotifyDeps }, who: Requester): Promise<string> {
  const job = await enqueueJob(deps.enqueue, {
    type: "account_delete",
    payload: { account_id: who.accountId, requested_by: who.personId },
    accountId: null,
    dedupeKey: `account_delete:${who.accountId}`,
  });
  await audit(db, who, "account.delete_requested", job.jobId, { deduped: job.deduped });
  await notify(deps.notify, {
    code: "security_event",
    accountId: who.accountId,
    message: {
      subject: "Pedido de exclusão da conta",
      body: `${who.personName} pediu para excluir a conta ${who.accountName} e todos os dados. A exclusão acontece em até 90 dias.`,
    },
  });
  return job.jobId;
}

/** The finished export zip of this account, as "<bucket>/<object>", or null (not done, other account). */
export async function exportPath(db: Db, accountId: string, jobId: string): Promise<string | null> {
  const { data } = await db.from("job").select("status, log, account_id, type").eq("id", jobId).maybeSingle();
  if (!data || data.type !== "account_export" || data.account_id !== accountId || data.status !== "done") return null;
  const entries = (Array.isArray(data.log) ? data.log : []) as { event?: string; path?: string }[];
  const path = entries.find((e) => e.event === "done" && typeof e.path === "string")?.path ?? null;
  return path?.startsWith("exports/") ? path : null;
}

/**
 * P06 downloads (closing PDF and xlsx): the close must be of the account and of a kitchen the person sees
 * (A03). An account-wide close (kitchen_id null) needs all kitchens, as app.sees_kitchen.
 */
export async function closeFilePath(db: Db, accountId: string, scope: Scope, closeId: string, format: "pdf" | "xlsx"): Promise<string | null> {
  const { data } = await db.from("close_period").select("kitchen_id, pdf_path, xlsx_path").eq("id", closeId).eq("account_id", accountId).maybeSingle();
  if (!data || !seesKitchen(scope, data.kitchen_id)) return null;
  const path = format === "pdf" ? data.pdf_path : data.xlsx_path;
  return path?.startsWith("closes/") ? path : null;
}

/** Streams "<bucket>/<object>" from private Storage with the service role. */
export async function storageFile(db: Db, path: string): Promise<Blob | null> {
  const [bucket, ...rest] = path.split("/");
  const { data, error } = await db.storage.from(bucket).download(rest.join("/"));
  return error ? null : data;
}
