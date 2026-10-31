// A05 and C20 against the local Supabase stack: the OpenFeature provider over public.flag_enabled and the
// change functions with their logs. Run with `pnpm test:int`. Creates and deletes its own synthetic account.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { OpenFeature } from "@openfeature/server-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { addException, MESSAGES, removeException, setPlanDefault, type Actor } from "./admin";
import { createFlags } from "./flags";
import { MargoFlagProvider } from "./provider";
import { SupabaseFlagAdminStore } from "./supabase-admin-store";
import { SupabaseFlagEvaluator } from "./supabase-evaluator";

const db = adminClient();
const tag = randomBytes(4).toString("hex");
let accountId = "";
const personIds: string[] = [];
let fundador: Actor;
let operacao: Actor;
const store = new SupabaseFlagAdminStore(db);
// The default changed below is restored in afterAll; production keeps its own value throughout.
const KEY = "m3.depara_ia";

async function flags() {
  const name = `int-${tag}`;
  await OpenFeature.setProviderAndWait(name, new MargoFlagProvider(new SupabaseFlagEvaluator(db), "sandbox"));
  return createFlags(async () => OpenFeature.getClient(name));
}

beforeAll(async () => {
  const plan = await db.from("plan").select("id").eq("code", "raio_x").single();
  const acc = await db
    .from("account")
    .insert({ name: "Conta flags", code: `T-FLAG-${tag}`, is_synthetic: true, plan_id: plan.data!.id })
    .select("id")
    .single();
  accountId = acc.data!.id;
  const people = await db
    .from("person")
    .insert([
      { name: "Fundador flags", email: `int-fundador-${tag}@teste.local` },
      { name: "Operação flags", email: `int-operacao-${tag}@teste.local` },
    ])
    .select("id, email");
  const id = (prefix: string) => people.data!.find((p) => p.email!.startsWith(prefix))!.id;
  personIds.push(id("int-fundador"), id("int-operacao"));
  await db.from("staff").insert([
    { person_id: personIds[0], role: "fundador" },
    { person_id: personIds[1], role: "operacao" },
  ]);
  fundador = { personId: personIds[0], ip: "10.0.0.1", userAgent: "vitest" };
  operacao = { personId: personIds[1], ip: null, userAgent: null };
});

afterAll(async () => {
  await db.rpc("flag_set_default", { p_key: KEY, p_env: "sandbox", p_plan: "lucro", p_value: true, p_actor: personIds[0] });
  await db.from("feature_flag_log").delete().in("by", personIds);
  await db.from("account").delete().eq("id", accountId);
  await db.from("person").delete().in("id", personIds);
});

describe("flags against the local stack", () => {
  it("A05_int_provider_reads_plan_default_and_exception", async () => {
    const f = await flags();
    // Raio-X, no subscription: account.plan_id applies.
    expect(await f.isEnabled("m1.raio_x", accountId)).toBe(true);
    expect(await f.isEnabled("m2.ifood_api", accountId)).toBe(false);
    await expect(f.requireFlag("m2.ifood_api", accountId)).rejects.toMatchObject({ digest: expect.stringContaining("404") });

    expect(await addException(store, fundador, { key: "m2.ifood_api", env: "sandbox", accountId, value: true, reason: "teste" })).toEqual({
      ok: true,
    });
    expect(await f.isEnabled("m2.ifood_api", accountId)).toBe(true);
    await expect(f.requireFlag("m2.ifood_api", accountId)).resolves.toBeUndefined();

    expect(await removeException(store, fundador, { key: "m2.ifood_api", env: "sandbox", accountId })).toEqual({ ok: true });
    expect(await f.isEnabled("m2.ifood_api", accountId)).toBe(false);
  });

  it("A05_int_trial_gets_lucro_defaults", async () => {
    const f = await flags();
    const plan = await db.from("plan").select("id").eq("code", "raio_x").single();
    await db.from("subscription").insert({ account_id: accountId, plan_id: plan.data!.id, status: "trial" });
    expect(await f.isEnabled("m2.ifood_api", accountId)).toBe(true);
    await db.from("subscription").update({ status: "free" }).eq("account_id", accountId);
    expect(await f.isEnabled("m2.ifood_api", accountId)).toBe(false);
  });

  it("A05_int_flag_evaluation_is_service_role_only", async () => {
    const anon = createClient(publicEnv().supabaseUrl, publicEnv().supabaseAnonKey, { auth: { persistSession: false } });
    const r = await anon.rpc("flag_enabled", { p_key: "m1.raio_x", p_account: accountId, p_env: "sandbox" });
    expect(r.error).not.toBeNull();
  });

  it("C20_int_changes_write_feature_flag_log_and_audit_log", async () => {
    expect(await setPlanDefault(store, operacao, { key: KEY, env: "sandbox", plan: "lucro", value: false })).toEqual({
      ok: false,
      error: "forbidden",
      message: MESSAGES.forbidden,
    });
    expect(await setPlanDefault(store, fundador, { key: KEY, env: "sandbox", plan: "lucro", value: false })).toEqual({ ok: true });

    const log = await db.from("feature_flag_log").select("flag_key, env, account_id, old, new, by").in("by", personIds);
    expect(log.data).toContainEqual({ flag_key: KEY, env: "sandbox", account_id: null, old: true, new: false, by: personIds[0] });
    expect(log.data!.filter((l) => l.account_id === accountId).map((l) => [l.old, l.new])).toEqual([
      [null, true],
      [true, null],
    ]);

    const audit = await db
      .from("audit_log")
      .select("actor_kind, action, account_id, ip, user_agent")
      .eq("actor_person_id", personIds[0])
      .order("action");
    expect(audit.data).toEqual([
      { actor_kind: "staff", action: "flag_default_set", account_id: null, ip: "10.0.0.1", user_agent: "vitest" },
      { actor_kind: "staff", action: "flag_exception_removed", account_id: accountId, ip: "10.0.0.1", user_agent: "vitest" },
      { actor_kind: "staff", action: "flag_exception_set", account_id: accountId, ip: "10.0.0.1", user_agent: "vitest" },
    ]);
  });
});
