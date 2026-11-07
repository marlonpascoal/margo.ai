// W09 Segurança e acesso (04 §8): the person's devices, sign-out per device, and the account's access log
// (Dono only, as the audit_log RLS policy). Sessions older than 30 days or revoked are not listed.
import { SESSION_TTL_MS } from "@/lib/auth/rules";
import type { MemberRole } from "@/lib/permissions";
import type { ReadDb } from "@/lib/supabase/reader";
import { actorNames, latestExportJob } from "./admin-reads";
import { accessWhen, deviceName, deviceWhen } from "./format";
import { PROFILE_LABEL } from "./entry";
import { dayMonSP } from "./scope";

export interface SessionRow {
  id: string;
  device_key_hash: string | null;
  user_agent: string | null;
  ip_city: string | null;
  last_seen_at: string;
}

export interface Device {
  /** Session rows of this device, all signed out by "Sair". */
  ids: string[];
  name: string;
  where: string;
  current: boolean;
}

/** One entry per device (the device cookie), newest first; the current one says "este aparelho". */
export function groupDevices(rows: SessionRow[], currentId: string, now: Date): Device[] {
  const current = rows.find((r) => r.id === currentId);
  const groups = new Map<string, SessionRow[]>();
  for (const r of rows) {
    const key = r.device_key_hash ?? `row:${r.id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((rs) => {
      const last = rs.reduce((a, b) => (a.last_seen_at >= b.last_seen_at ? a : b));
      const isCurrent = rs.some((r) => r.id === currentId) || (!!current?.device_key_hash && rs[0].device_key_hash === current.device_key_hash);
      const when = isCurrent ? "este aparelho" : deviceWhen(new Date(last.last_seen_at), now);
      return { ids: rs.map((r) => r.id), name: deviceName(last.user_agent), where: [when, last.ip_city].filter(Boolean).join(" · "), current: isCurrent, at: last.last_seen_at };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || b.at.localeCompare(a.at))
    .map(({ ids, name, where, current: c }) => ({ ids, name, where, current: c }));
}

export async function loadDevices(db: ReadDb, personId: string, currentId: string, now = new Date()): Promise<Device[]> {
  const since = new Date(now.getTime() - SESSION_TTL_MS.portal).toISOString();
  const { data, error } = await db
    .from("session_device")
    .select("id, device_key_hash, user_agent, ip_city, last_seen_at")
    .eq("person_id", personId)
    .eq("surface", "portal")
    .is("revoked_at", null)
    .gt("created_at", since);
  if (error) throw new Error(error.message);
  return groupDevices(data ?? [], currentId, now);
}

export interface AuditRow {
  action: string;
  actor_person_id: string | null;
  actorName: string | null;
  after: Record<string, unknown> | null;
  at: string;
}

export const ACCESS_ACTIONS = ["login", "login.new_device", "invite.create", "invite.accept", "logout_all", "session.revoke"];

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** W09 "Registro de acesso" lines, as drawn ("Você entrou com código por e-mail", "Pessoa do financeiro entrou"). */
export function accessLine(r: AuditRow, me: string): string {
  const you = r.actor_person_id === me;
  const who = you ? "Você" : (r.actorName ?? "Alguém");
  switch (r.action) {
    case "login":
      return you ? "Você entrou com código por e-mail" : `${who} entrou`;
    case "login.new_device":
      return `Login em aparelho novo${str(r.after?.device) ? `: ${str(r.after?.device)}` : ""}`;
    case "invite.create": {
      const role = str(r.after?.role) as MemberRole;
      return `${who} convidou ${str(r.after?.name) || "uma pessoa"}${PROFILE_LABEL[role] ? ` (${PROFILE_LABEL[role]})` : ""}`;
    }
    case "invite.accept":
      return `${who} aceitou o convite`;
    case "logout_all":
      return `${who} saiu de todos os aparelhos`;
    case "session.revoke":
      return `${who} tirou um aparelho da conta`;
    default:
      return r.action;
  }
}

export async function loadAccessLog(db: ReadDb, accountId: string, me: string, now = new Date(), limit = 10): Promise<{ when: string; text: string }[]> {
  const { data, error } = await db
    .from("audit_log")
    .select("action, actor_person_id, after, at")
    .eq("account_id", accountId)
    .eq("actor_kind", "person")
    .in("action", ACCESS_ACTIONS)
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const ids = [...new Set((data ?? []).map((r) => r.actor_person_id).filter((x): x is string => !!x))];
  const names = await actorNames(ids);
  return (data ?? []).map((r) => ({
    when: accessWhen(new Date(r.at), now),
    text: accessLine({ ...r, actorName: r.actor_person_id ? (names.get(r.actor_person_id) ?? null) : null, after: (r.after ?? null) as Record<string, unknown> | null }, me),
  }));
}

/** W09 data section copy. Not drawn; same style as P15. */
export const W09_MESSAGES = {
  exportQueued: "Estamos preparando o arquivo com todos os dados. Ele aparece aqui para baixar em alguns minutos.",
  deletionQueued: "Pedido de exclusão recebido. Mandamos a confirmação por e-mail. Tudo é apagado em até 90 dias.",
  noEmail: "Para confirmar com código, a conta precisa de um e-mail de login.",
} as const;

export interface LatestExport {
  status: "preparing" | "ready";
  href: string | null;
  /** "20/nov" */
  day: string;
}

/** E06: the account's last data export, to link "Baixar o arquivo" (route /app/dados/[job]). */
export async function loadLatestExport(accountId: string): Promise<LatestExport | null> {
  const data = await latestExportJob(accountId);
  if (!data) return null;
  const day = dayMonSP(data.created_at);
  return data.status === "done" ? { status: "ready", href: `/app/dados/${data.id}`, day } : { status: "preparing", href: null, day };
}
