// Per-request client that reads and writes the Supabase session cookies.
import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@margoai/contracts";
import { publicEnv } from "@/lib/env";
import { accountReader, personReader, type ReadableClient, type ReadDb } from "./reader";

/** One client per render, so an expired token is refreshed once. */
export const sessionClient = cache(async () => {
  const store = await cookies();
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; proxy.ts refreshes the session before render.
        }
      },
    },
  });
});

/** The portal's reads as the signed-in person (D63): one opened account, or null before one is chosen. */
export async function sessionReader(accountId: string | null): Promise<ReadDb> {
  const client = (await sessionClient()) as unknown as ReadableClient;
  return accountId ? accountReader(client, accountId) : personReader(client);
}
