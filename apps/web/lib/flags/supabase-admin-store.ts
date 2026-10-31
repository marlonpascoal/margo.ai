// FlagAdminStore over the C20 SQL functions, with the service role. Covered by flags.int.test.ts.
import type { Db } from "@/lib/supabase/admin";
import type { Actor, DefaultChange, ExceptionChange, ExceptionRemoval, FlagAdminStore, StaffRole } from "./admin";

function check(res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(res.error.message);
}

const who = (a: Actor) => ({ p_actor: a.personId, p_ip: a.ip ?? undefined, p_user_agent: a.userAgent ?? undefined });

export class SupabaseFlagAdminStore implements FlagAdminStore {
  constructor(private db: Db) {}

  async staffRole(personId: string): Promise<StaffRole | null> {
    const { data, error } = await this.db.from("staff").select("role").eq("person_id", personId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.role ?? null;
  }

  async setDefault(c: DefaultChange, actor: Actor): Promise<void> {
    check(await this.db.rpc("flag_set_default", { p_key: c.key, p_env: c.env, p_plan: c.plan, p_value: c.value, ...who(actor) }));
  }

  async setException(c: ExceptionChange, actor: Actor): Promise<void> {
    check(
      await this.db.rpc("flag_set_override", {
        p_key: c.key,
        p_env: c.env,
        p_account: c.accountId,
        p_value: c.value,
        p_reason: c.reason,
        ...who(actor),
      }),
    );
  }

  async removeException(r: ExceptionRemoval, actor: Actor): Promise<void> {
    check(await this.db.rpc("flag_remove_override", { p_key: r.key, p_env: r.env, p_account: r.accountId, ...who(actor) }));
  }
}
