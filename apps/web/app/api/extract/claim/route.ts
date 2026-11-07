// POST /api/extract/claim: the next queued discover or capture job, up to the running limit (docs/extract-api.md, 02 §4).
import { NextResponse } from "next/server";
import { claimNext } from "@/lib/extract/server";
import { adminClient } from "@/lib/supabase/admin";
import { json, readRequest } from "../request";

export async function POST(req: Request) {
  const read = await readRequest(req);
  if ("refused" in read) return read.refused;
  const worker = read.body.worker;
  if (typeof worker !== "string" || worker.trim() === "" || worker.length > 100) return json({ errors: ["worker: required"] }, 422);
  const job = await claimNext(adminClient(), worker);
  if (!job) return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  return json(job);
}
