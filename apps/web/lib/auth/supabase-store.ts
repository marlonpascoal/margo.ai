// LoginStore over Postgres, with the service role (04 §8). Covered by login.int.test.ts.
import type { Db } from "@/lib/supabase/admin";
import type { NotifyDeps } from "@/lib/notify/outbox";
import { notifyNewDevice } from "@/lib/notify/security";
import { SupabaseNotifyStore } from "@/lib/notify/supabase-store";
import type { AuditRow, LoginPerson, LoginStore, SessionRow } from "./login";
import { emptyGuard, type Guard, type Surface } from "./rules";

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** For queries that always return data (lists, single). */
function must<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  const data = check(res);
  if (data === null || data === undefined) throw new Error("query returned no data");
  return data;
}

export class SupabaseLoginStore implements LoginStore {
  constructor(
    private db: Db,
    private notify: NotifyDeps = { store: new SupabaseNotifyStore(db), now: () => new Date() },
  ) {}

  async getGuard(email: string): Promise<Guard> {
    const row = check(await this.db.from("auth_code_guard").select("sent_at, attempts, locked_until").eq("email", email).maybeSingle());
    if (!row) return emptyGuard();
    return {
      sentAt: row.sent_at ? new Date(row.sent_at) : null,
      attempts: row.attempts,
      lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
    };
  }

  async saveGuard(email: string, g: Guard): Promise<void> {
    check(
      await this.db.from("auth_code_guard").upsert(
        {
          email,
          sent_at: g.sentAt?.toISOString() ?? null,
          attempts: g.attempts,
          locked_until: g.lockedUntil?.toISOString() ?? null,
        },
        { onConflict: "email" },
      ),
    );
  }

  async findPerson(email: string, surface: Surface): Promise<LoginPerson | null> {
    const person = check(await this.db.from("person").select("id, auth_user_id").ilike("email", email).maybeSingle());
    if (!person) return null;
    if (surface === "console") {
      const staff = check(await this.db.from("staff").select("id").eq("person_id", person.id).maybeSingle());
      return staff ? { id: person.id, authUserId: person.auth_user_id, accountIds: [], donoAccountIds: [] } : null;
    }
    const memberships = must(await this.db.from("membership").select("account_id, role").eq("person_id", person.id));
    if (memberships.length === 0) return null;
    return {
      id: person.id,
      authUserId: person.auth_user_id,
      accountIds: memberships.map((m) => m.account_id).sort(),
      donoAccountIds: memberships.filter((m) => m.role === "dono").map((m) => m.account_id).sort(),
    };
  }

  async linkAuthUser(personId: string, authUserId: string): Promise<void> {
    check(await this.db.from("person").update({ auth_user_id: authUserId }).eq("id", personId).is("auth_user_id", null));
  }

  async deviceHistory(personId: string, deviceKeyHash: string) {
    const rows = must(await this.db.from("session_device").select("device_key_hash").eq("person_id", personId));
    return { anyDevice: rows.length > 0, thisDevice: rows.some((r) => r.device_key_hash === deviceKeyHash) };
  }

  async createSession(row: SessionRow): Promise<string> {
    const created = must(
      await this.db
        .from("session_device")
        .insert({
          person_id: row.personId,
          surface: row.surface,
          auth_session_id: row.authSessionId,
          device_key_hash: row.deviceKeyHash,
          user_agent: row.userAgent,
          ip_city: row.ipCity,
        })
        .select("id")
        .single(),
    );
    return created.id;
  }

  async notifyNewDevice(personId: string, accountIds: string[], userAgent: string | null): Promise<void> {
    // 04 §9, E05: planned per Dono through the notifier, so preferences apply; e-mail always goes (locked).
    if (accountIds.length === 0) return;
    const who = must(await this.db.from("person").select("name").eq("id", personId).single());
    const synthetic = must(await this.db.from("account").select("id").in("id", accountIds).eq("is_synthetic", true)).map((a) => a.id);
    await notifyNewDevice(this.notify, { personName: who.name, accountIds, userAgent, syntheticAccountIds: synthetic });
  }

  async audit(rows: AuditRow[]): Promise<void> {
    if (rows.length === 0) return;
    check(
      await this.db.from("audit_log").insert(
        rows.map((r) => ({
          actor_person_id: r.personId,
          actor_kind: r.actorKind,
          account_id: r.accountId,
          action: r.action,
          entity: "session_device",
        })),
      ),
    );
  }
}
