// C14 Configurações (05 §A), Fundador only. Copy verbatim from design/C14-Config.dc.html.
// Secrets: only "set" or "missing" ever leaves this module, never a value (02 §6, A06).
import type { Db } from "@/lib/supabase/admin";
import { dayMonth } from "@/lib/format";
import type { StaffRole } from "@/lib/permissions";

// Secrets ------------------------------------------------------------------------------------------

type Platform = "Vercel" | "Maritime";
interface SecretDef {
  name: string;
  where: Platform[];
}

/** 02 §6 table. */
export const SECRETS: SecretDef[] = [
  { name: "SUPABASE_SERVICE_ROLE_KEY", where: ["Vercel", "Maritime"] },
  { name: "IFOOD_CLIENT_ID", where: ["Vercel", "Maritime"] },
  { name: "IFOOD_CLIENT_SECRET", where: ["Vercel", "Maritime"] },
  { name: "ANTHROPIC_API_KEY", where: ["Maritime"] },
  { name: "ASAAS_API_KEY", where: ["Vercel"] },
  { name: "ASAAS_WEBHOOK_TOKEN", where: ["Vercel"] },
  { name: "MARITIME_WEBHOOK_SIGNING_KEY", where: ["Vercel", "Maritime"] },
  { name: "EMAIL_PROVIDER_KEY", where: ["Vercel"] },
];

/**
 * "set": present in this app's environment (Vercel). "missing": absent there. "elsewhere": lives only
 * on Maritime, which this app cannot see. "not_kept": we never hold it (D45, client A1 certificate).
 */
export type SecretState = "set" | "missing" | "elsewhere" | "not_kept";
export interface SecretStatus {
  name: string;
  where: string;
  state: SecretState;
}

/** Reads presence only; the value never leaves this function. */
export function secretsStatus(env: Record<string, string | undefined> = process.env): SecretStatus[] {
  const rows: SecretStatus[] = SECRETS.map((s) => ({
    name: s.name,
    where: s.where.join(" e "),
    state: !s.where.includes("Vercel") ? "elsewhere" : env[s.name] ? "set" : "missing",
  }));
  rows.push({ name: "certificado A1 de cliente", where: "não guardamos", state: "not_kept" });
  return rows;
}

// Owner authorizations ------------------------------------------------------------------------------

const SCOPE_LABEL: Record<string, string> = { ifood: "iFood", food99: "99Food", notas: "notas" };

/** "iFood (API e extensão)", "iFood, 99Food, notas". */
export function scopeText(scope: string[]): string {
  const parts: string[] = [];
  const api = scope.includes("ifood_api");
  const ext = scope.includes("extensao");
  if (api || ext) parts.push(`iFood (${[api && "API", ext && "extensão"].filter(Boolean).join(" e ")})`);
  for (const s of scope) if (SCOPE_LABEL[s]) parts.push(SCOPE_LABEL[s]);
  return parts.join(", ");
}

/** Last digits only ("0001-10"), enough to tell two CNPJs of one account apart; never the full number. */
export const cnpjTail = (cnpj: string) => `${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;

export type AuthState = "signed" | "not_needed";
export interface AuthorizationRow {
  title: string;
  detail: string;
  status: string;
  state: AuthState;
}

interface AuthFact {
  accountName: string;
  accountCode: string;
  cnpj: string;
  scope: string[];
  includesAi: boolean;
  signedAt: Date;
}
interface AccountFact {
  name: string;
  code: string;
  hasConnectedStore: boolean;
}

/** One row per CNPJ with an authorization; accounts without one show "só dado público". */
export function authorizationRows(auths: AuthFact[], accounts: AccountFact[]): AuthorizationRow[] {
  const perAccount = new Map<string, number>();
  for (const a of auths) perAccount.set(a.accountCode, (perAccount.get(a.accountCode) ?? 0) + 1);
  const rows: (AuthorizationRow & { code: string })[] = auths.map((a) => ({
    code: a.accountCode,
    title: `${a.accountName} (${a.accountCode})`,
    detail: [
      (perAccount.get(a.accountCode) ?? 0) > 1 ? `CNPJ final ${cnpjTail(a.cnpj)}` : "",
      scopeText(a.scope),
      a.includesAi ? "IA incluída" : "",
    ]
      .filter(Boolean)
      .join(" · "),
    status: `assinada ${dayMonth(a.signedAt)}`,
    state: "signed",
  }));
  for (const acc of accounts) {
    if (perAccount.has(acc.code) || acc.hasConnectedStore) continue;
    rows.push({ code: acc.code, title: `${acc.name} (${acc.code})`, detail: "só dado público", status: "não precisa ainda", state: "not_needed" });
  }
  return rows.sort((x, y) => x.code.localeCompare(y.code)).map(({ title, detail, status, state }) => ({ title, detail, status, state }));
}

// Staff ---------------------------------------------------------------------------------------------

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = { fundador: "Fundador", operacao: "Operação" };

// X-ray defaults and retention: params with no settings table yet (04 header); defaults from the rules.

/** M1-01 default radius and M1-04 default min_pairs. */
export const XRAY_DEFAULTS = { radiusKm: 3, minPairs: 5 } as const;
/** 02 §7: deletion 90 days after a client leaves; 30 is the other option drawn. */
export const RETENTION_DAYS = [90, 30] as const;

// Loader --------------------------------------------------------------------------------------------

export interface SettingsView {
  authorizations: AuthorizationRow[];
  secrets: SecretStatus[];
  staff: { name: string; role: string }[];
}

export async function loadSettings(db: Db): Promise<SettingsView> {
  const [auths, accounts, staff] = await Promise.all([
    db.from("owner_authorization").select("scope, includes_ai, signed_at, account(name, code), company(cnpj)").order("signed_at"),
    db.from("account").select("name, code, channel_store(authorized, source)"),
    db.from("staff").select("role, created_at, person!staff_person_id_fkey(name)").order("created_at").order("person_id"),
  ]);
  for (const r of [auths, accounts, staff]) if (r.error) throw r.error;

  const authorizations = authorizationRows(
    (auths.data ?? []).map((a) => ({
      accountName: a.account!.name,
      accountCode: a.account!.code,
      cnpj: a.company!.cnpj,
      scope: a.scope,
      includesAi: a.includes_ai,
      signedAt: new Date(a.signed_at),
    })),
    (accounts.data ?? []).map((a) => ({
      name: a.name,
      code: a.code,
      hasConnectedStore: a.channel_store.some((s) => s.authorized && s.source !== "public"),
    })),
  );
  return {
    authorizations,
    secrets: secretsStatus(),
    staff: (staff.data ?? []).map((s) => ({ name: s.person!.name, role: STAFF_ROLE_LABEL[s.role] })),
  };
}
