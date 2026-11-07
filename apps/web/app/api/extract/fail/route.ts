// POST /api/extract/fail: the extractor could not do a running job (docs/extract-api.md).
import { isFailReason } from "@/lib/extract/contract";
import { ExtractRefused, isJobId, recordFailure } from "@/lib/extract/server";
import { enqueueDeps } from "@/lib/jobs/deps";
import { adminClient } from "@/lib/supabase/admin";
import { json, readRequest } from "../request";

export async function POST(req: Request) {
  const read = await readRequest(req);
  if ("refused" in read) return read.refused;
  const { job_id: jobId, reason, detail } = read.body;
  if (!isJobId(jobId)) return json({ error: "unknown job" }, 404);
  if (!isFailReason(reason)) return json({ errors: ['reason: must be "blocked", "not_found", "parse_error", "timeout" or "other"'] }, 422);
  if (detail !== undefined && detail !== null && typeof detail !== "string") return json({ errors: ["detail: must be a string"] }, 422);
  try {
    await recordFailure(adminClient(), enqueueDeps(), jobId, reason, typeof detail === "string" ? detail : null);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof ExtractRefused) return json({ error: e.message }, e.status);
    throw e;
  }
}
