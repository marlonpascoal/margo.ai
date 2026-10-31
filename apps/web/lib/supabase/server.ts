// Per-request client that reads and writes the Supabase session cookies.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@margoai/contracts";
import { publicEnv } from "@/lib/env";

export async function sessionClient() {
  const store = await cookies();
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}
