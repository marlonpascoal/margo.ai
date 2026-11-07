// Enqueue a job and wake its worker (02 §4.1, 02 §4.2, A07).
// The row is the source of truth: if the wake-up is lost, the job stays queued and the stuck-job sweep or
// a later wake-up picks it up. A duplicate wake-up is harmless: the worker's claim has one winner.
import { signWakeup, type WakeupBody } from "./sign";

export type { WakeupBody };

export type JobInsert = {
  type: string;
  payload: Record<string, unknown>;
  accountId: string | null;
  dedupeKey: string | null;
};

export interface JobQueue {
  /** Insert a queued job; with a dedupe key already active (queued or running), return that job. */
  insert(job: JobInsert): Promise<{ id: string; deduped: boolean }>;
}

export type EnqueueDeps = {
  queue: JobQueue;
  /** Webhook URL of the worker that serves this type, or null when nothing needs waking (local polling). */
  agentUrl: (type: string) => string | null;
  /** MARITIME_WEBHOOK_SIGNING_KEY, read at call time. */
  signingKey: () => string | Uint8Array;
  wake: (agentUrl: string, body: WakeupBody) => Promise<void>;
  now: () => Date;
};

export type EnqueueInput = {
  type: string;
  payload?: Record<string, unknown>;
  accountId?: string | null;
  dedupeKey?: string | null;
};

export type EnqueueResult = { jobId: string; deduped: boolean; woken: boolean };

export async function enqueueJob(deps: EnqueueDeps, input: EnqueueInput): Promise<EnqueueResult> {
  const { id, deduped } = await deps.queue.insert({
    type: input.type,
    payload: input.payload ?? {},
    accountId: input.accountId ?? null,
    dedupeKey: input.dedupeKey ?? null,
  });
  return { jobId: id, deduped, woken: await wakeJob(deps, id, input.type) };
}

/** Wakes the worker of a job already in the queue; a lost wake-up leaves it queued. */
export async function wakeJob(deps: Pick<EnqueueDeps, "agentUrl" | "signingKey" | "wake" | "now">, id: string, type: string): Promise<boolean> {
  const url = deps.agentUrl(type);
  if (!url) return false;
  try {
    await deps.wake(url, signWakeup(id, deps.signingKey(), deps.now()));
    return true;
  } catch (e) {
    // Ids only (02 §7); the job stays queued.
    console.error(JSON.stringify({ event: "job_wake_failed", job_id: id, type, error: (e as Error).name }));
    return false;
  }
}
