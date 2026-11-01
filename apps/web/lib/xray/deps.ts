// Production wiring of the M1 commands: service-role RPC and the job queue (lib/jobs).
import { enqueueJob } from "@/lib/jobs/enqueue";
import { enqueueDeps } from "@/lib/jobs/deps";
import { flagEnv } from "@/lib/flags/keys";
import { adminClient } from "@/lib/supabase/admin";
import type { XrayDeps } from "./commands";

export function xrayDeps(): XrayDeps {
  const db = adminClient();
  return {
    env: flagEnv(),
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

/** C02 ?conta=: the account with this code (C01 shows codes like G-02), or null. */
export async function accountByCode(code: string): Promise<{ id: string; code: string; name: string } | null> {
  if (!/^[A-Z0-9-]{1,32}$/.test(code)) return null;
  const { data } = await adminClient().from("account").select("id, code, name").eq("code", code).maybeSingle();
  return data ?? null;
}
