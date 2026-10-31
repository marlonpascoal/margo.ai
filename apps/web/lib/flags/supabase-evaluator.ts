// FlagEvaluator over public.flag_enabled, with the service role. Covered by flags.int.test.ts.
import type { Db } from "@/lib/supabase/admin";
import type { FlagEnv } from "./keys";
import type { FlagEvaluator } from "./provider";

export class SupabaseFlagEvaluator implements FlagEvaluator {
  constructor(private db: Db) {}

  async enabled(key: string, accountId: string | null, env: FlagEnv): Promise<boolean> {
    // The generated type marks p_account as required text; null is the console/system evaluation.
    const { data, error } = await this.db.rpc("flag_enabled", { p_key: key, p_account: accountId as string, p_env: env });
    if (error) throw new Error(error.message);
    return data === true;
  }
}
