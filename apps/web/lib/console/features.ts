// C20 Funcionalidades (design/C20-Funcionalidades.dc.html, 04 §6): plan defaults and account exceptions
// per environment. Reading only; changes go through lib/flags/admin.ts (Fundador, feature_flag_log, audit_log).
import { FLAG_KEYS, isFlagKey, PLAN_CODES, type FlagEnv, type FlagKey, type PlanCode } from "@/lib/flags/keys";
import type { Db } from "@/lib/supabase/admin";

/** Environment switch, labels as drawn. */
export const ENV_OPTIONS: { value: FlagEnv; label: string }[] = [
  { value: "sandbox", label: "teste (sandbox)" },
  { value: "production", label: "produção" },
];

/** Plan columns, as drawn. */
export const PLAN_LABEL: Record<PlanCode, string> = { raio_x: "Raio-X", lucro: "Lucro", rede: "Rede" };
export const PLANS = PLAN_CODES;

export const onOff = (value: boolean) => (value ? "ligada" : "desligada");

/** "G-03 ligada: ligada no teste grátis". The drawing shows code and reason; the value is spelled out too. */
export const exceptionText = (code: string, value: boolean, reason: string) => `${code} ${onOff(value)}: ${reason}`;

export function parseEnv(value: string | string[] | undefined, fallback: FlagEnv): FlagEnv {
  return value === "sandbox" || value === "production" ? value : fallback;
}

export interface FlagRecord {
  key: string;
  description: string;
  default_raio_x: boolean;
  default_lucro: boolean;
  default_rede: boolean;
}

export interface OverrideRecord {
  flag_key: string;
  account_id: string;
  value: boolean;
  reason: string;
}

export interface ExceptionView {
  accountId: string;
  accountCode: string;
  value: boolean;
  reason: string;
  text: string;
}

export interface FlagRow {
  key: FlagKey;
  description: string;
  defaults: Record<PlanCode, boolean>;
  exceptions: ExceptionView[];
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
}

/** 04 §6 table order; keys the code does not know are left out. */
export function buildFlagRows(flags: FlagRecord[], overrides: OverrideRecord[], accounts: Map<string, { code: string }>): FlagRow[] {
  const byKey = new Map(flags.filter((f) => isFlagKey(f.key)).map((f) => [f.key as FlagKey, f]));
  return FLAG_KEYS.filter((k) => byKey.has(k)).map((key) => {
    const f = byKey.get(key)!;
    const exceptions = overrides
      .filter((o) => o.flag_key === key)
      .map((o) => {
        const accountCode = accounts.get(o.account_id)?.code ?? "?";
        return { accountId: o.account_id, accountCode, value: o.value, reason: o.reason, text: exceptionText(accountCode, o.value, o.reason) };
      })
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    return {
      key,
      description: f.description,
      defaults: { raio_x: f.default_raio_x, lucro: f.default_lucro, rede: f.default_rede },
      exceptions,
    };
  });
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Service-role read, after requireConsole("flags"). */
export async function loadFeatures(db: Db, env: FlagEnv): Promise<{ rows: FlagRow[]; accounts: AccountOption[] }> {
  const [flags, overrides, accounts] = await Promise.all([
    db.from("feature_flag").select("key, description, default_raio_x, default_lucro, default_rede").eq("env", env),
    db.from("feature_override").select("flag_key, account_id, value, reason").eq("env", env),
    db.from("account").select("id, code, name").order("code"),
  ]);
  const accountList = must(accounts);
  const byId = new Map(accountList.map((a) => [a.id, a]));
  return { rows: buildFlagRows(must(flags), must(overrides), byId), accounts: accountList };
}
