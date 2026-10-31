// Production wiring: one OpenFeature provider per server process, over public.flag_enabled.
import { OpenFeature, type Client } from "@openfeature/server-sdk";
import { adminClient } from "@/lib/supabase/admin";
import { createFlags } from "./flags";
import { flagEnv } from "./keys";
import { MargoFlagProvider } from "./provider";
import { SupabaseFlagEvaluator } from "./supabase-evaluator";

const DOMAIN = "margo";
let ready: Promise<Client> | null = null;

function client(): Promise<Client> {
  ready ??= OpenFeature.setProviderAndWait(DOMAIN, new MargoFlagProvider(new SupabaseFlagEvaluator(adminClient()), flagEnv()))
    .then(() => OpenFeature.getClient(DOMAIN))
    .catch((e: unknown) => {
      ready = null;
      throw e;
    });
  return ready;
}

export const { isEnabled, requireFlag } = createFlags(client);
export { FLAG_KEYS, flagEnv, type FlagEnv, type FlagKey, type PlanCode } from "./keys";
