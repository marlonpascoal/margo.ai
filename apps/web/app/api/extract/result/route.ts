// POST /api/extract/result: allowlisted copies of a running job, applied in one transaction (D47c,
// docs/extract-api.md). Repeating a job that ended well changes nothing.
import { parseExtractResult } from "@/lib/extract/contract";
import { ExtractRefused, isJobId, jobState, recordResult } from "@/lib/extract/server";
import { enqueueDeps } from "@/lib/jobs/deps";
import { adminClient } from "@/lib/supabase/admin";
import { json, readRequest } from "../request";

export async function POST(req: Request) {
  const read = await readRequest(req);
  if ("refused" in read) return read.refused;
  const { job_id: jobId } = read.body;
  if (!isJobId(jobId)) return json({ error: "unknown job" }, 404);
  const db = adminClient();
  const state = await jobState(db, jobId);
  if (!state) return json({ error: "unknown job" }, 404);
  if (state.status === "done") return json({ ok: true, copies: state.copies ?? 0, dropped: [] });
  if (state.status !== "running") return json({ error: "job is not running" }, 409);
  const parsed = parseExtractResult(state.kind, state.external_id, read.body, new Date());
  if (!parsed.ok) return json({ errors: parsed.errors, dropped: parsed.dropped }, 422);
  try {
    const copies = await recordResult(db, enqueueDeps(), jobId, parsed.source, parsed.collectedAt, parsed.copies);
    return json({ ok: true, copies, dropped: parsed.dropped });
  } catch (e) {
    if (e instanceof ExtractRefused) return json({ error: e.message }, e.status);
    throw e;
  }
}
