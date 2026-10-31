// E03, C00 against the local Supabase stack: real e-mail OTP, codes read from the local Mailpit inbox.
// Run with `pnpm test:int` (scripts/with-local-env.mjs). Creates and deletes its own synthetic account.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { MESSAGES, sendCode, verifyCode, type LoginDeps } from "./login";
import { SupabaseAuthGateway } from "./supabase-gateway";
import { SupabaseLoginStore } from "./supabase-store";

const db = adminClient();
const tag = randomBytes(4).toString("hex");
const accountCode = `T-INT-${tag}`;
const emails = { dono: `int-dono-${tag}@teste.local`, fin: `int-fin-${tag}@teste.local`, staff: `int-staff-${tag}@teste.local` };
let accountId = "";
const personIds: string[] = [];

function deps(): LoginDeps {
  const anon = createClient(publicEnv().supabaseUrl, publicEnv().supabaseAnonKey, { auth: { persistSession: false } });
  return { store: new SupabaseLoginStore(db), gateway: new SupabaseAuthGateway(anon), now: () => new Date() };
}
const ctx = { userAgent: "vitest", ipCity: null, deviceKey: `device-${tag}` };

async function mailTo(email: string, timeoutMs = 5000): Promise<string | null> {
  const base = process.env.MAILPIT_URL!;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const list = (await res.json()) as { messages: { ID: string }[] };
    if (list.messages?.length) {
      const msg = (await (await fetch(`${base}/api/v1/message/${list.messages[0].ID}`)).json()) as { Text: string; Subject: string };
      return `${msg.Subject}\n${msg.Text}`;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
const codeIn = (mail: string) => mail.match(/\b(\d{6})\b/)![1];

beforeAll(async () => {
  const acc = await db.from("account").insert({ name: "Conta integração", code: accountCode, is_synthetic: true }).select("id").single();
  accountId = acc.data!.id;
  const people = await db
    .from("person")
    .insert([
      { name: "Dono integração", email: emails.dono },
      { name: "Financeiro integração", email: emails.fin },
      { name: "Staff integração", email: emails.staff },
    ])
    .select("id, email");
  for (const p of people.data!) personIds.push(p.id);
  const id = (e: string) => people.data!.find((p) => p.email === e)!.id;
  await db.from("membership").insert([
    { account_id: accountId, person_id: id(emails.dono), role: "dono" },
    { account_id: accountId, person_id: id(emails.fin), role: "financeiro" },
  ]);
  await db.from("staff").insert({ person_id: id(emails.staff), role: "operacao" });
});

afterAll(async () => {
  const { data: people } = await db.from("person").select("auth_user_id").in("id", personIds);
  await db.from("account").delete().eq("id", accountId);
  await db.from("person").delete().in("id", personIds);
  await db.from("auth_code_guard").delete().like("email", `%-${tag}@teste.local`);
  for (const p of people ?? []) if (p.auth_user_id) await db.auth.admin.deleteUser(p.auth_user_id);
});

describe("login against the local stack", () => {
  it("E03_int_portal_code_arrives_by_email_and_opens_a_session", async () => {
    expect(await sendCode(deps(), { email: emails.dono, surface: "portal" })).toEqual({ ok: true, message: MESSAGES.sent });
    const mail = await mailTo(emails.dono);
    expect(mail).toContain("Seu código de acesso à MargoAI");

    const r = await verifyCode(deps(), { email: emails.dono, code: codeIn(mail!), surface: "portal", ctx });
    expect(r.ok).toBe(true);

    const person = await db.from("person").select("id, auth_user_id").eq("email", emails.dono).single();
    expect(person.data!.auth_user_id).not.toBeNull();
    const session = await db.from("session_device").select("surface, auth_session_id, device_key_hash").eq("person_id", person.data!.id).single();
    expect(session.data).toMatchObject({ surface: "portal" });
    expect(session.data!.auth_session_id).toMatch(/^[0-9a-f-]{36}$/);
    const audit = await db.from("audit_log").select("action, actor_kind").eq("account_id", accountId);
    expect(audit.data).toEqual([{ action: "login", actor_kind: "person" }]);
  });

  it("C00_int_non_invited_email_gets_no_email", async () => {
    const stranger = `int-stranger-${tag}@teste.local`;
    expect(await sendCode(deps(), { email: stranger, surface: "console" })).toEqual({ ok: true, message: MESSAGES.sent });
    expect(await mailTo(stranger, 1500)).toBeNull();
    // A restaurant person is not staff either.
    await sendCode(deps(), { email: emails.fin, surface: "console" });
    expect(await mailTo(emails.fin, 1500)).toBeNull();
  });

  it("E03_int_five_wrong_codes_lock_even_the_right_one", async () => {
    await db.from("auth_code_guard").delete().eq("email", emails.fin);
    await sendCode(deps(), { email: emails.fin, surface: "portal" });
    const code = codeIn((await mailTo(emails.fin))!);
    const wrong = code === "000000" ? "111111" : "000000";
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await verifyCode(deps(), { email: emails.fin, code: wrong, surface: "portal", ctx }));
    expect(results.map((r) => !r.ok && r.message)).toEqual([...Array(4).fill(MESSAGES.wrong), MESSAGES.locked]);
    expect(await verifyCode(deps(), { email: emails.fin, code, surface: "portal", ctx })).toEqual({ ok: false, message: MESSAGES.locked });
    const guard = await db.from("auth_code_guard").select("locked_until").eq("email", emails.fin).single();
    expect(new Date(guard.data!.locked_until!).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it("E03_int_console_login_for_staff", async () => {
    await sendCode(deps(), { email: emails.staff, surface: "console" });
    const r = await verifyCode(deps(), { email: emails.staff, code: codeIn((await mailTo(emails.staff))!), surface: "console", ctx });
    expect(r.ok).toBe(true);
    const session = await db.from("session_device").select("surface").eq("person_id", personIds[2]).single();
    expect(session.data).toEqual({ surface: "console" });
  });
});
