// A07: enqueueJob inserts the row with its dedupe key, then wakes the worker with a signed body.
// The wake call is injected; no test reaches Maritime or any other host.
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueueJob, type EnqueueDeps, type JobInsert, type JobQueue, type WakeupBody } from "./enqueue";
import { verifyWakeup } from "./sign";

class FakeQueue implements JobQueue {
  rows: (JobInsert & { id: string; status: "queued" | "running" | "done" })[] = [];
  async insert(job: JobInsert) {
    const active = this.rows.find(
      (r) => job.dedupeKey !== null && r.type === job.type && r.dedupeKey === job.dedupeKey && r.status !== "done",
    );
    if (active) return { id: active.id, deduped: true };
    const id = `00000000-0000-4000-8000-${String(this.rows.length + 1).padStart(12, "0")}`;
    this.rows.push({ ...job, id, status: "queued" });
    return { id, deduped: false };
  }
}

const key = randomBytes(32); // throwaway, never committed
const now = new Date("2026-10-31T09:00:00Z");
let queue: FakeQueue;
let wakes: { url: string; body: WakeupBody }[];
let deps: EnqueueDeps;

beforeEach(() => {
  queue = new FakeQueue();
  wakes = [];
  deps = {
    queue,
    agentUrl: (type) => `https://agent.test/${type}`,
    signingKey: () => key,
    wake: async (url, body) => {
      wakes.push({ url, body });
    },
    now: () => now,
  };
});

describe("enqueueJob", () => {
  it("A07: inserts a queued row and sends one signed wake-up to the worker of that type", async () => {
    const res = await enqueueJob(deps, { type: "import", payload: { store_id: "s1" }, accountId: "a1", dedupeKey: "s1:2026-09" });
    expect(res).toEqual({ jobId: queue.rows[0].id, deduped: false, woken: true });
    expect(queue.rows).toMatchObject([{ type: "import", payload: { store_id: "s1" }, accountId: "a1", dedupeKey: "s1:2026-09" }]);
    expect(wakes).toHaveLength(1);
    expect(wakes[0].url).toBe("https://agent.test/import");
    expect(verifyWakeup(wakes[0].body, key, now)).toBe(res.jobId);
  });

  it("A07: the same dedupe key while active returns the existing job", async () => {
    const a = await enqueueJob(deps, { type: "import", dedupeKey: "s1:2026-09" });
    const b = await enqueueJob(deps, { type: "import", dedupeKey: "s1:2026-09" });
    expect(b).toMatchObject({ jobId: a.jobId, deduped: true });
    expect(queue.rows).toHaveLength(1);
  });

  it("keeps the job queued when the wake-up fails", async () => {
    deps.wake = async () => {
      throw new Error("network");
    };
    const res = await enqueueJob(deps, { type: "render" });
    expect(res.woken).toBe(false);
    expect(queue.rows[0].status).toBe("queued");
  });

  it("does not wake when no agent serves the type (local: the LocalRunner polls)", async () => {
    deps.agentUrl = () => null;
    const res = await enqueueJob(deps, { type: "render" });
    expect(res.woken).toBe(false);
    expect(wakes).toEqual([]);
  });
});
