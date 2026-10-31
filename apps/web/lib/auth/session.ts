// Session checks for every page and server action (02 §5, 04 §8). UI hiding is not security:
// callers use currentSession() and refuse when it returns null.
import { adminClient, type Db } from "@/lib/supabase/admin";
import { sessionClient } from "@/lib/supabase/server";
import { sessionExpired, type Surface } from "./rules";
import { sessionIdOf } from "./supabase-gateway";

type DeviceRow = { surface: Surface; created_at: string; revoked_at: string | null };
export type SessionState = "ok" | "unknown" | "wrong_surface" | "revoked" | "expired";

export function checkSession(row: DeviceRow | null, surface: Surface, now: Date): SessionState {
  if (!row) return "unknown";
  if (row.surface !== surface) return "wrong_surface";
  if (row.revoked_at) return "revoked";
  if (sessionExpired(new Date(row.created_at), surface, now)) return "expired";
  return "ok";
}

export interface CurrentSession {
  personId: string;
  sessionDeviceId: string;
  surface: Surface;
}

const TOUCH_EVERY_MS = 5 * 60_000;

export async function currentSession(surface: Surface, now = new Date()): Promise<CurrentSession | null> {
  const supabase = await sessionClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  // getUser() asks Auth whether the session still exists (signed out elsewhere, deleted user).
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;

  const db = adminClient();
  const authSessionId = sessionIdOf(data.session.access_token);
  const { data: row } = await db
    .from("session_device")
    .select("id, person_id, surface, created_at, revoked_at, last_seen_at")
    .eq("auth_session_id", authSessionId)
    .maybeSingle();
  const state = checkSession(row, surface, now);
  if (state !== "ok" || !row) {
    if (state === "expired" || state === "revoked") await supabase.auth.signOut({ scope: "local" });
    return null;
  }
  if (now.getTime() - new Date(row.last_seen_at).getTime() > TOUCH_EVERY_MS) {
    await db.from("session_device").update({ last_seen_at: now.toISOString() }).eq("id", row.id);
  }
  return { personId: row.person_id, sessionDeviceId: row.id, surface };
}

/** W09 "Sair de todos os aparelhos": revokes every session of the person, audited. */
export async function signOutEverywhere(db: Db, personId: string, accountIds: string[], now = new Date()) {
  await db.from("session_device").update({ revoked_at: now.toISOString() }).eq("person_id", personId).is("revoked_at", null);
  await db.from("audit_log").insert(
    (accountIds.length ? accountIds : [null]).map((accountId) => ({
      actor_person_id: personId,
      actor_kind: "person" as const,
      account_id: accountId,
      action: "logout_all",
      entity: "session_device",
    })),
  );
}
