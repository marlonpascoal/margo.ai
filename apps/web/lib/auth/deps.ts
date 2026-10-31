// Production wiring of the login flow.
import { adminClient } from "@/lib/supabase/admin";
import { sessionClient } from "@/lib/supabase/server";
import type { LoginDeps } from "./login";
import { SupabaseAuthGateway } from "./supabase-gateway";
import { SupabaseLoginStore } from "./supabase-store";

export async function loginDeps(): Promise<LoginDeps> {
  return {
    store: new SupabaseLoginStore(adminClient()),
    gateway: new SupabaseAuthGateway(await sessionClient()),
    now: () => new Date(),
  };
}
