// Production wiring of the M1 commands: service-role RPC and the job queue (lib/jobs).
import { enqueueJob } from "@/lib/jobs/enqueue";
import { enqueueDeps } from "@/lib/jobs/deps";
import { adminClient } from "@/lib/supabase/admin";
import type { XrayDeps } from "./commands";

export function xrayDeps(): XrayDeps {
  const db = adminClient();
  return {
    async rpc(fn, args) {
      // The function names are the M1 functions of migration 20261104000011.
      const { data, error } = await db.rpc(fn as never, args as never);
      if (error) throw new Error(error.message);
      return data;
    },
    async enqueue(job) {
      await enqueueJob(enqueueDeps(), job);
    },
  };
}

/** The account of the channel store with this iFood uuid (D29), or null for a lead. */
export async function accountOfStore(externalId: string): Promise<string | null> {
  const { data } = await adminClient().from("channel_store").select("account_id").eq("channel", "ifood").eq("external_id", externalId).maybeSingle();
  return data?.account_id ?? null;
}
