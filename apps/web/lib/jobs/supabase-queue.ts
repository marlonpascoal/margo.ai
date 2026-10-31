// JobQueue over Postgres, with the service role (02 §4.1). Covered by enqueue.int.test.ts.
import type { Json } from "@margoai/contracts";
import type { Db } from "@/lib/supabase/admin";
import type { JobInsert, JobQueue } from "./enqueue";

const UNIQUE_VIOLATION = "23505";

export class SupabaseJobQueue implements JobQueue {
  constructor(private db: Db) {}

  async insert(job: JobInsert): Promise<{ id: string; deduped: boolean }> {
    const res = await this.db
      .from("job")
      .insert({ type: job.type, payload: job.payload as { [key: string]: Json }, account_id: job.accountId, dedupe_key: job.dedupeKey })
      .select("id")
      .single();
    if (!res.error) return { id: res.data.id, deduped: false };
    if (res.error.code !== UNIQUE_VIOLATION || job.dedupeKey === null) throw new Error(res.error.message);
    const active = await this.db
      .from("job")
      .select("id")
      .eq("type", job.type)
      .eq("dedupe_key", job.dedupeKey)
      .in("status", ["queued", "running"])
      .maybeSingle();
    if (active.error) throw new Error(active.error.message);
    if (!active.data) throw new Error("job insert conflicted without an active duplicate");
    return { id: active.data.id, deduped: true };
  }
}
