// Production wiring of the M1 owner journey: service-role RPC for the monitor_* functions (migrations 20261230000001
// and 20261230000002) and wake-ups of the jobs they queue (02 §4). Reads pair it with Member.db (lib/monitor/load.ts).
import { enqueueJob, wakeJob } from "@/lib/jobs/enqueue";
import { enqueueDeps } from "@/lib/jobs/deps";
import { flagEnv } from "@/lib/flags/keys";
import { adminClient } from "@/lib/supabase/admin";
import type { ReadDb } from "@/lib/supabase/reader";
import type { MonitorDeps } from "./commands";
import type { LoadDeps } from "./load";
import type { PrintDeps } from "./print";

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await adminClient().rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data;
}

export function monitorDeps(): MonitorDeps {
  return {
    env: flagEnv(),
    rpc,
    async wake(jobId, type) {
      await wakeJob(enqueueDeps(), jobId, type);
    },
  };
}

/** Loaders: the member's scoped reader first (RLS), then the service-role loaders. */
export function loadDeps(db: ReadDb): LoadDeps {
  return { db, rpc, env: flagEnv() };
}

/** "Baixar PDF" wiring: the private print cache, the job queue and the one-time token of worker-render. */
export function printDeps(): PrintDeps {
  const db = adminClient();
  return {
    async printed(xrayId, version) {
      const { data, error } = await db.from("xray_print").select("path, pages").eq("xray_id", xrayId).eq("version", version).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async enqueue(job) {
      const r = await enqueueJob(enqueueDeps(), job);
      return { jobId: r.jobId, deduped: r.deduped };
    },
    async useToken(xrayId, hash) {
      return (await rpc("xray_print_token_use", { p_xray: xrayId, p_hash: hash })) === true;
    },
  };
}

/** The PDF bytes of a printed copy (private pdf bucket), after the person's check. */
export async function printedPdf(path: string): Promise<Blob | null> {
  const { data, error } = await adminClient().storage.from("pdf").download(path);
  return error ? null : data;
}

export { rpc as serviceRpc };
