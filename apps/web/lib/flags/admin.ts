// C20 changes: plan defaults and account exceptions (04 §5, §6, D34). Fundador only, checked here on the
// server and again inside the SQL functions, which write the change, feature_flag_log and audit_log in one
// transaction.
import { canManageFlags, type StaffRole } from "@/lib/permissions";
import { isFlagKey, isPlanCode, type FlagEnv, type FlagKey, type PlanCode } from "./keys";

export type { StaffRole };

/** The staff member making the change, from the console session. */
export interface Actor {
  personId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface DefaultChange {
  key: FlagKey;
  env: FlagEnv;
  plan: PlanCode;
  value: boolean;
}

export interface ExceptionChange {
  key: FlagKey;
  env: FlagEnv;
  accountId: string;
  value: boolean;
  reason: string;
}

export type ExceptionRemoval = Omit<ExceptionChange, "value" | "reason">;

export interface FlagAdminStore {
  staffRole(personId: string): Promise<StaffRole | null>;
  setDefault(change: DefaultChange, actor: Actor): Promise<void>;
  setException(change: ExceptionChange, actor: Actor): Promise<void>;
  removeException(removal: ExceptionRemoval, actor: Actor): Promise<void>;
}

// Not drawn; same style as the console copy.
export const MESSAGES = {
  forbidden: "Só o papel Fundador muda funcionalidades.",
  reason: "Escreva o motivo da exceção.",
  invalid: "Funcionalidade, plano ou ambiente inválido.",
} as const;

export type AdminResult = { ok: true } | { ok: false; error: "forbidden" | "invalid"; message: string };

const isEnv = (v: unknown): v is FlagEnv => v === "sandbox" || v === "production";
const forbidden: AdminResult = { ok: false, error: "forbidden", message: MESSAGES.forbidden };
const invalid = (message: string = MESSAGES.invalid): AdminResult => ({ ok: false, error: "invalid", message });

async function asFundador(store: FlagAdminStore, actor: Actor, write: () => Promise<void>): Promise<AdminResult> {
  if (!canManageFlags(await store.staffRole(actor.personId))) return forbidden;
  await write();
  return { ok: true };
}

export async function setPlanDefault(store: FlagAdminStore, actor: Actor, change: DefaultChange): Promise<AdminResult> {
  if (!isFlagKey(change.key) || !isEnv(change.env) || !isPlanCode(change.plan) || typeof change.value !== "boolean") {
    return invalid();
  }
  return asFundador(store, actor, () => store.setDefault(change, actor));
}

export async function addException(store: FlagAdminStore, actor: Actor, change: ExceptionChange): Promise<AdminResult> {
  if (!isFlagKey(change.key) || !isEnv(change.env) || !change.accountId || typeof change.value !== "boolean") return invalid();
  const reason = change.reason?.trim();
  if (!reason) return invalid(MESSAGES.reason);
  return asFundador(store, actor, () => store.setException({ ...change, reason }, actor));
}

export async function removeException(store: FlagAdminStore, actor: Actor, removal: ExceptionRemoval): Promise<AdminResult> {
  if (!isFlagKey(removal.key) || !isEnv(removal.env) || !removal.accountId) return invalid();
  return asFundador(store, actor, () => store.removeException(removal, actor));
}
