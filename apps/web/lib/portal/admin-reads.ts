// The owner portal's reads that stay on the service role (D63, 02 §5), each for one reason RLS rightly refuses
// the whole row while the page needs one value. Every other portal read goes through Member.db. Callers have
// checked the person and the account; each function takes the opened account and selects only what is shown.
// eslint-disable-next-line no-restricted-imports -- this file is the exception list
import { adminClient } from "@/lib/supabase/admin";
import { closePeriods, type ClosePeriod } from "@/lib/m2/close";
import type { Channel } from "@/lib/m2/format";

/** A03: RLS hides the whole-account close from a Gerente; their month list needs its id and month, no file path. */
export async function closePeriodsOutsideScope(accountId: string): Promise<ClosePeriod[]> {
  return (await closePeriods(adminClient(), accountId)).map((p) => ({ ...p, pdfPath: null }));
}

/** W01/P08 "Extensão instalada": tokens are own-rows under RLS (they hold the hash); the state is the account's. */
export async function extensionPaired(accountId: string): Promise<boolean> {
  const { count } = await adminClient().from("extension_token").select("id", { count: "exact", head: true }).eq("account_id", accountId).is("revoked_at", null);
  return (count ?? 0) > 0;
}

/** W02 "Dados chegando": import plumbing is console only under RLS; the page needs the last good time per channel. */
export async function lastImportsOk(accountId: string): Promise<{ data: { channel: Channel; last_ok_at: string | null }[] | null; error: { message: string } | null }> {
  return adminClient().from("import_source").select("channel, last_ok_at").eq("account_id", accountId).not("last_ok_at", "is", null);
}

/** W04 "Último acesso": devices are own-rows under RLS (they hold ip and user agent); the Dono sees only the time. */
export async function lastSeenOf(personIds: string[]): Promise<Map<string, string>> {
  const last = new Map<string, string>();
  if (personIds.length === 0) return last;
  const { data, error } = await adminClient().from("session_device").select("person_id, last_seen_at").in("person_id", personIds);
  if (error) throw new Error(error.message);
  for (const d of data ?? []) if (!last.has(d.person_id) || d.last_seen_at > last.get(d.person_id)!) last.set(d.person_id, d.last_seen_at);
  return last;
}

/** W09 access log: an actor may have left the account, and RLS then hides the person; the log keeps the name. */
export async function actorNames(personIds: string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const { data } = await adminClient().from("person").select("id, name").in("id", personIds);
  return new Map((data ?? []).map((p) => [p.id, p.name]));
}

/** W09 "Baixar o arquivo": job is console only under RLS (its log names files and errors); id, status and date. */
export async function latestExportJob(accountId: string) {
  const { data, error } = await adminClient()
    .from("job")
    .select("id, status, created_at")
    .eq("account_id", accountId)
    .eq("type", "account_export")
    .in("status", ["queued", "running", "done"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
