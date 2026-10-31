// Production wiring of enqueueJob (02 §4). Locally (MARGO_ENV=local) nothing is woken: the LocalRunner
// polls the queue, so no call leaves the machine.
import { adminClient } from "@/lib/supabase/admin";
import { maritimeAgentId, maritimeSigningKey } from "@/lib/env";
import type { EnqueueDeps, WakeupBody } from "./enqueue";
import { SupabaseJobQueue } from "./supabase-queue";

const MARITIME_WEBHOOKS = "https://api.maritime.sh/api/webhooks";

async function httpWake(agentUrl: string, body: WakeupBody): Promise<void> {
  const res = await fetch(agentUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`wake-up returned ${res.status}`);
}

export function enqueueDeps(): EnqueueDeps {
  return {
    queue: new SupabaseJobQueue(adminClient()),
    agentUrl: (type) => {
      if (process.env.MARGO_ENV === "local") return null;
      const agent = maritimeAgentId(type);
      return agent ? `${MARITIME_WEBHOOKS}/${encodeURIComponent(agent)}` : null;
    },
    signingKey: maritimeSigningKey,
    wake: httpWake,
    now: () => new Date(),
  };
}
