// /api/extract/* over the SQL functions of migration 20261220000002 (docs/extract-api.md). No external call,
// and the database answers never carry the street address. Wake-ups follow 02 §4.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Json } from "@margoai/contracts";
import { flagEnv } from "@/lib/flags/keys";
import { wakeJob, type EnqueueDeps } from "@/lib/jobs/enqueue";
import type { Db } from "@/lib/supabase/admin";
import type { ExtractCopy, ExtractKind, FailReason } from "./contract";

/** Vercel refuses request bodies past 4.5 MB; ours stops first. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** D47b: Bearer against MARGO_EXTRACT_TOKEN, constant time. A missing env refuses everything. */
export function extractAuthorized(header: string | null, expected: string | undefined = process.env.MARGO_EXTRACT_TOKEN): boolean {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!expected || !m) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(m[1]), digest(expected));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isJobId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export class ExtractRefused extends Error {
  constructor(readonly status: 404 | 409) {
    super(status === 404 ? "unknown job" : "job is not running");
  }
}

/** The errors the SQL functions raise for a job, as statuses; anything else is rethrown. */
function raise(message: string): never {
  if (message.includes("extract_unknown_job")) throw new ExtractRefused(404);
  if (message.includes("extract_job_not_running")) throw new ExtractRefused(409);
  throw new Error(message);
}

export interface Claimed {
  job_id: string;
  kind: ExtractKind;
  payload: Json;
}

/** 02 §4: the next job, one at a time. Null when there is no work. */
export async function claimNext(db: Db, worker: string): Promise<Claimed | null> {
  const res = await db.rpc("extract_claim_next", { p_worker: worker, p_env: flagEnv() });
  if (res.error) throw new Error(res.error.message);
  return (res.data?.[0] as Claimed | undefined) ?? null;
}

export interface JobState {
  kind: ExtractKind;
  status: "queued" | "running" | "done" | "failed";
  external_id: string | null;
  copies: number | null;
}

export async function jobState(db: Db, jobId: string): Promise<JobState | null> {
  const res = await db.rpc("extract_job_state", { p_job: jobId });
  if (res.error) throw new Error(res.error.message);
  return (res.data as unknown as JobState | null) ?? null;
}

async function wake(deps: EnqueueDeps, ids: unknown): Promise<void> {
  for (const id of Array.isArray(ids) ? ids : []) await wakeJob(deps, String(id), "xray_neighborhood");
}

/** Writes the run and the copies and applies them, in one transaction. */
export async function recordResult(db: Db, deps: EnqueueDeps, jobId: string, source: string, collectedAt: string, copies: ExtractCopy[]): Promise<number> {
  const res = await db.rpc("extract_record_result", {
    p_job: jobId,
    p_source: source,
    p_collected_at: collectedAt,
    p_copies: copies as unknown as Json,
  });
  if (res.error) raise(res.error.message);
  const out = res.data as { copies: number; wake: unknown };
  await wake(deps, out.wake);
  return out.copies;
}

export async function recordFailure(db: Db, deps: EnqueueDeps, jobId: string, reason: FailReason, detail: string | null): Promise<void> {
  const res = await db.rpc("extract_record_failure", { p_job: jobId, p_reason: reason, p_detail: detail ?? "" });
  if (res.error) raise(res.error.message);
  await wake(deps, (res.data as { wake: unknown }).wake);
}

/** D47c, daily cron: captures of stores in active X-rays whose last one is older than m1.extract_every_days. */
export async function queueDueCaptures(db: Db): Promise<number> {
  const res = await db.rpc("extract_queue_due", { p_env: flagEnv() });
  if (res.error) throw new Error(res.error.message);
  return res.data as number;
}
