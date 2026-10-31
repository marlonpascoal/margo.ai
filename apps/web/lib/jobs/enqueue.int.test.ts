// A07 against the local Supabase stack: the row lands in public.job and the dedupe key holds.
// Run with `pnpm test:int`. The wake call is a recorder; nothing leaves the machine.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { adminClient } from "@/lib/supabase/admin";
import { enqueueJob, type EnqueueDeps, type WakeupBody } from "./enqueue";
import { verifyWakeup } from "./sign";
import { SupabaseJobQueue } from "./supabase-queue";

const db = adminClient();
const type = `test_int_${randomBytes(4).toString("hex")}`;
const key = randomBytes(32); // throwaway, never committed
const wakes: WakeupBody[] = [];
const deps: EnqueueDeps = {
  queue: new SupabaseJobQueue(db),
  agentUrl: () => "https://agent.test/never-called",
  signingKey: () => key,
  wake: async (_url, body) => {
    wakes.push(body);
  },
  now: () => new Date(),
};

afterAll(async () => {
  await db.from("job").delete().eq("type", type);
});

describe("enqueueJob on the local stack", () => {
  it("A07: inserts a queued row and wakes once per call with a verifiable body", async () => {
    const res = await enqueueJob(deps, { type, payload: { n: 1 }, dedupeKey: "k1" });
    const row = await db.from("job").select("status, payload, dedupe_key, attempts").eq("id", res.jobId).single();
    expect(row.data).toEqual({ status: "queued", payload: { n: 1 }, dedupe_key: "k1", attempts: 0 });
    expect(verifyWakeup(wakes.at(-1)!, key, new Date())).toBe(res.jobId);
  });

  it("A07: an active dedupe key returns the same job, a finished one allows a new job", async () => {
    const a = await enqueueJob(deps, { type, dedupeKey: "k2" });
    const b = await enqueueJob(deps, { type, dedupeKey: "k2" });
    expect(b).toMatchObject({ jobId: a.jobId, deduped: true });
    await db.from("job").update({ status: "done" }).eq("id", a.jobId);
    const c = await enqueueJob(deps, { type, dedupeKey: "k2" });
    expect(c.deduped).toBe(false);
    expect(c.jobId).not.toBe(a.jobId);
  });
});
