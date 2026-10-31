#!/usr/bin/env node
// Runs a command with the local Supabase stack's URLs and keys in its environment.
// They are fixed public defaults of the local stack (D44), read at run time so no .env file exists.
import { execFileSync, spawn } from "node:child_process";

const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL,
  MARGO_ENV: "local",
  // Workers and DB tests connect straight to Postgres (this worktree may run its stack on other ports).
  MARGO_LOCAL_DB_URL: process.env.MARGO_LOCAL_DB_URL ?? status.DB_URL,
};
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
