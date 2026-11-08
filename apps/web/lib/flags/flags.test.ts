// A05 and 04 §6: the OpenFeature provider and the screen helpers, against a fake evaluator
// (the SQL rule has its pgTAP tests; the Supabase evaluator has flags.int.test.ts).
import { OpenFeature } from "@openfeature/server-sdk";
import { describe, expect, it } from "vitest";
import { createFlags } from "./flags";
import { FLAG_KEYS, flagEnv, type FlagEnv } from "./keys";
import { MargoFlagProvider, type FlagEvaluator } from "./provider";

class FakeEvaluator implements FlagEvaluator {
  on = new Set<string>();
  calls: { key: string; accountId: string | null; env: FlagEnv }[] = [];
  fail = false;
  async enabled(key: string, accountId: string | null, env: FlagEnv) {
    this.calls.push({ key, accountId, env });
    if (this.fail) throw new Error("database down");
    return this.on.has(`${key}|${accountId}|${env}`);
  }
}

let domain = 0;
async function setup(env: FlagEnv = "sandbox") {
  const evaluator = new FakeEvaluator();
  const name = `test-${++domain}`;
  await OpenFeature.setProviderAndWait(name, new MargoFlagProvider(evaluator, env));
  const flags = createFlags(async () => OpenFeature.getClient(name));
  return { evaluator, flags, client: OpenFeature.getClient(name) };
}

describe("feature flags (04 §6)", () => {
  it("A05_provider_asks_the_evaluator_for_the_account_and_env", async () => {
    const { evaluator, flags } = await setup("production");
    evaluator.on.add("m2.ifood_api|acc-1|production");
    expect(await flags.isEnabled("m2.ifood_api", "acc-1")).toBe(true);
    expect(await flags.isEnabled("m2.ifood_api", "acc-2")).toBe(false);
    expect(evaluator.calls.map((c) => c.env)).toEqual(["production", "production"]);
  });

  it("A05_console_and_system_checks_pass_no_account", async () => {
    const { evaluator, flags } = await setup();
    evaluator.on.add("m1.raio_x|null|sandbox");
    expect(await flags.isEnabled("m1.raio_x", null)).toBe(true);
    expect(evaluator.calls[0]).toEqual({ key: "m1.raio_x", accountId: null, env: "sandbox" });
  });

  it("A05_evaluation_error_counts_as_off", async () => {
    const { evaluator, flags } = await setup();
    evaluator.on.add("m1.raio_x|acc-1|sandbox");
    evaluator.fail = true;
    expect(await flags.isEnabled("m1.raio_x", "acc-1")).toBe(false);
  });

  it("A05_flag_off_hides_the_screen_with_404", async () => {
    const { evaluator, flags } = await setup();
    await expect(flags.requireFlag("m2.contestacao", "acc-1")).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    evaluator.on.add("m2.contestacao|acc-1|sandbox");
    await expect(flags.requireFlag("m2.contestacao", "acc-1")).resolves.toBeUndefined();
  });

  it("A05_flags_are_boolean_only", async () => {
    const { client } = await setup();
    const details = await client.getStringDetails("m1.raio_x", "x", { targetingKey: "acc-1" });
    expect(details).toMatchObject({ value: "x", errorCode: "TYPE_MISMATCH" });
  });

  it("A05_env_comes_from_MARGO_FLAG_ENV_default_sandbox", () => {
    expect(flagEnv(undefined)).toBe("sandbox");
    expect(flagEnv("")).toBe("sandbox");
    expect(flagEnv("production")).toBe("production");
    expect(() => flagEnv("prod")).toThrow(/MARGO_FLAG_ENV/);
  });

  it("A05_twenty_three_keys_of_04_section_6_with_m1_concorrente_m1_extracao_m3_custo_provisional_m1_portal_m1_oportunidades_ia_and_launch_screen_flags", () => {
    expect(FLAG_KEYS).toHaveLength(23);
    expect(new Set(FLAG_KEYS).size).toBe(23);
    expect(FLAG_KEYS.indexOf("m1.portal")).toBe(FLAG_KEYS.indexOf("m1.extracao") + 1);
    expect(FLAG_KEYS.indexOf("m1.oportunidades_ia")).toBe(FLAG_KEYS.indexOf("m1.portal") + 1);
    expect(FLAG_KEYS.indexOf("m1.concorrente")).toBe(FLAG_KEYS.indexOf("m1.raio_x") + 1);
    expect(FLAG_KEYS.indexOf("m1.extracao")).toBe(FLAG_KEYS.indexOf("m1.concorrente") + 1);
    expect(FLAG_KEYS.indexOf("m3.custo")).toBe(FLAG_KEYS.indexOf("m3.depara_ia") + 1);
  });
});
