// Shared steps for the e2e tests. Local stack only: env comes from scripts/with-local-env.mjs.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const ARTIFACTS = path.join(ROOT, "artifacts");

/** Seed founder (G-SYN). */
export const FOUNDER_EMAIL = "marlon@margoai.com";

export function adminDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const mailpit = () => process.env.MAILPIT_URL!;
const query = (email: string) => encodeURIComponent(`to:"${email}"`);

export async function clearMail(email: string) {
  await fetch(`${mailpit()}/api/v1/search?query=${query(email)}`, { method: "DELETE" });
}

/** The 6-digit code in the newest message to this address, or null after the timeout. */
export async function mailCode(email: string, timeoutMs = 8000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${mailpit()}/api/v1/search?query=${query(email)}`)).json()) as { messages?: { ID: string }[] };
    if (list.messages?.length) {
      const msg = (await (await fetch(`${mailpit()}/api/v1/message/${list.messages[0].ID}`)).json()) as { Text: string };
      const m = msg.Text.match(/\b(\d{6})\b/);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/** Codes can be resent after 60 seconds (04 §8); wait out a send from an earlier run. */
export async function waitForResendWindow(email: string) {
  const db = adminDb();
  // Our guard keeps the send time after a good code; Supabase Auth also keeps its own 60 seconds.
  const times: (string | null | undefined)[] = [];
  const { data: guard } = await db.from("auth_code_guard").select("sent_at").eq("email", email).maybeSingle();
  times.push(guard?.sent_at);
  const { data: person } = await db.from("person").select("auth_user_id").eq("email", email).maybeSingle();
  if (person?.auth_user_id) {
    const { data } = await db.auth.admin.getUserById(person.auth_user_id);
    const u = data.user as unknown as Record<string, string | null | undefined> | null;
    times.push(u?.confirmation_sent_at, u?.recovery_sent_at, u?.email_change_sent_at);
  }
  const last = Math.max(0, ...times.filter((t): t is string => !!t).map((t) => new Date(t).getTime()));
  const wait = last + 62_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** C00 end to end: e-mail, code from Mailpit, lands on C01. */
export async function loginToConsole(page: Page, email: string) {
  await waitForResendWindow(email);
  await clearMail(email);
  await page.goto("/console/login");
  await page.getByLabel("E-mail de trabalho").fill(email);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("status")).toHaveText("Mandamos um código de 6 números para o seu e-mail. Ele vale por 10 minutos.");
  const code = await mailCode(email);
  expect(code, "code e-mail in Mailpit").not.toBeNull();
  await page.getByLabel("Código que chegou no e-mail").fill(code!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/console");
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
}

/** A temporary staff member for one run; returns a cleanup function. */
export async function createStaff(email: string, name: string, role: "fundador" | "operacao") {
  const db = adminDb();
  const { data: person, error } = await db.from("person").insert({ name, email }).select("id").single();
  if (error) throw error;
  await db.from("staff").insert({ person_id: person.id, role });
  return async () => {
    const { data } = await db.from("person").select("auth_user_id").eq("id", person.id).single();
    await db.from("person").delete().eq("id", person.id);
    await db.from("auth_code_guard").delete().eq("email", email);
    if (data?.auth_user_id) await db.auth.admin.deleteUser(data.auth_user_id);
  };
}

/** Same ids as the G-SYN seed (pg_temp.sid): md5('g-syn:' || tag)::uuid. */
export function sid(tag: string): string {
  const h = createHash("md5").update(`g-syn:${tag}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** One queued job of this type through the local runner (`uv run worker <type> --local --once`). */
export function runWorker(type: string) {
  execFileSync("node", ["scripts/with-local-env.mjs", "uv", "run", "worker", type, "--local", "--once"], { cwd: ROOT, stdio: "pipe", timeout: 120_000 });
}
