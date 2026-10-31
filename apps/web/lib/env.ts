// Environment read at run time. Values come from the platform (Vercel) or, locally, from
// scripts/with-local-env.mjs. Never from a .env file (D44).

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

export const publicEnv = () => ({
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
});

/** Server only. */
export const serviceRoleKey = () => required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
