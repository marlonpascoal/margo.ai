// The account a module 2 console screen is about, its flags (04 §6) and audited writes (A04).
// Server code only, after requireConsole("clients").
import { notFound } from "next/navigation";
import type { Json } from "@margoai/contracts";
import { isEnabled } from "@/lib/flags";
import type { FlagKey } from "@/lib/flags/keys";
import type { Db } from "@/lib/supabase/admin";
import type { Channel } from "./format";

export interface M2Account {
  id: string;
  code: string;
  name: string;
  isSynthetic: boolean;
}

export async function accountByCode(db: Db, code: string): Promise<M2Account> {
  const { data, error } = await db.from("account").select("id, code, name, is_synthetic").eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) notFound();
  return { id: data.id, code: data.code, name: data.name, isSynthetic: data.is_synthetic };
}

/** File import flag per channel (04 §6). */
export const FILE_FLAG: Partial<Record<Channel, FlagKey>> = { ifood: "m2.arquivo_ifood", food99: "m2.arquivo_99food" };
/** Job type per channel (workers/common JOB_FLAGS). */
export const FILE_JOB: Partial<Record<Channel, string>> = { ifood: "import_ifood_file", food99: "import_99food_file" };

/** A05: a screen behind several flags shows when any is on; otherwise 404. */
export async function requireAnyFlag(keys: FlagKey[], accountId: string): Promise<Record<string, boolean>> {
  const values = await Promise.all(keys.map((k) => isEnabled(k, accountId)));
  if (!values.some(Boolean)) notFound();
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

export interface AuditInput {
  actor: string;
  accountId: string;
  action: string;
  entity: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  meta: { ip: string | null; userAgent: string | null };
}

/** A04: every write by a person writes audit_log. Console writes are by staff. */
export async function audit(db: Db, a: AuditInput): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    actor_person_id: a.actor,
    actor_kind: "staff",
    account_id: a.accountId,
    action: a.action,
    entity: a.entity,
    entity_id: a.entityId,
    before: (a.before ?? null) as Json,
    after: (a.after ?? null) as Json,
    ip: a.meta.ip,
    user_agent: a.meta.userAgent,
  });
  if (error) throw new Error(error.message);
}
