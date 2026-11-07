// Production wiring of the M1 owner journey: service-role RPC for the monitor_* functions (migrations 20261230000001
// and 20261230000002) and wake-ups of the jobs they queue (02 §4). Reads pair it with Member.db (lib/monitor/load.ts).
import { wakeJob } from "@/lib/jobs/enqueue";
import { enqueueDeps } from "@/lib/jobs/deps";
import { flagEnv } from "@/lib/flags/keys";
import { adminClient } from "@/lib/supabase/admin";
import type { ReadDb } from "@/lib/supabase/reader";
import type { MonitorDeps } from "./commands";
import type { LoadDeps } from "./load";

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
