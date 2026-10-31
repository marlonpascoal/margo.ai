// C20 Funcionalidades (04 §6): table rows from feature_flag and feature_override, as drawn.
import { describe, expect, it } from "vitest";
import { FLAG_KEYS } from "@/lib/flags/keys";
import { buildFlagRows, exceptionText, onOff, parseEnv, type FlagRecord, type OverrideRecord } from "./features";

const flag = (key: string, description: string, r: boolean, l: boolean, d: boolean): FlagRecord => ({
  key,
  description,
  default_raio_x: r,
  default_lucro: l,
  default_rede: d,
});
const accounts = new Map([
  ["a1", { code: "G-01", name: "Pantanos Burguer" }],
  ["a2", { code: "G-02", name: "Grupo Exemplo" }],
  ["a3", { code: "G-03", name: "Grupo B" }],
]);

describe("C20 rows", () => {
  it("C20_rows_follow_the_04_section_6_key_order_with_defaults_per_plan", () => {
    const flags = [...FLAG_KEYS].reverse().map((k) => flag(k, `desc ${k}`, k === "m1.raio_x", true, false));
    const rows = buildFlagRows(flags, [], accounts);
    expect(rows.map((r) => r.key)).toEqual([...FLAG_KEYS]);
    expect(rows[0]).toEqual({ key: "m1.raio_x", description: "desc m1.raio_x", defaults: { raio_x: true, lucro: true, rede: false }, exceptions: [] });
  });

  it("C20_exceptions_show_account_code_value_and_reason_sorted_by_code", () => {
    const overrides: OverrideRecord[] = [
      { flag_key: "bpo.marca_propria", account_id: "a2", value: true, reason: "BPO 01" },
      { flag_key: "bpo.marca_propria", account_id: "a1", value: false, reason: "BPO 01" },
    ];
    const [row] = buildFlagRows([flag("bpo.marca_propria", "Fechamento com a marca do BPO", false, false, false)], overrides, accounts);
    expect(row.exceptions.map((e) => [e.accountId, e.text])).toEqual([
      ["a1", "G-01 desligada: BPO 01"],
      ["a2", "G-02 ligada: BPO 01"],
    ]);
  });

  it("C20_unknown_keys_in_the_table_are_left_out", () => {
    expect(buildFlagRows([flag("x.nao_existe", "?", true, true, true)], [], accounts)).toEqual([]);
  });

  it("C20_labels_as_drawn", () => {
    expect(onOff(true)).toBe("ligada");
    expect(onOff(false)).toBe("desligada");
    expect(exceptionText("G-03", true, "ligada no teste grátis")).toBe("G-03 ligada: ligada no teste grátis");
  });

  it("C20_env_switch_accepts_only_sandbox_or_production", () => {
    expect(parseEnv("production", "sandbox")).toBe("production");
    expect(parseEnv("sandbox", "production")).toBe("sandbox");
    expect(parseEnv("prod", "sandbox")).toBe("sandbox");
    expect(parseEnv(undefined, "production")).toBe("production");
    expect(parseEnv(["production"], "sandbox")).toBe("sandbox");
  });
});
