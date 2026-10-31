// Service-role client. Server code only, after a permission check (02 §5).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@margoai/contracts";
import { publicEnv, serviceRoleKey } from "@/lib/env";

export type Db = SupabaseClient<Database>;

export function adminClient(): Db {
  return createClient<Database>(publicEnv().supabaseUrl, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
