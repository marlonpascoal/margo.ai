// Daily runs of the monitorings due (M1 owner journey) and capture of the stores in active X-rays (D47c, m1.extract_every_days), from Vercel Cron (02 §4.3,
// vercel.json). Vercel sends `Authorization: Bearer <CRON_SECRET>`; anything else gets 401. The queue is the
// only thing touched: the flag m1.extracao is checked per account in SQL, and extractors poll /api/extract/claim.
import { NextResponse, type NextRequest } from "next/server";
import { tokenMatches } from "@/lib/billing/webhook";
import { queueDueCaptures, queueDueMonitors } from "@/lib/extract/server";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!tokenMatches(bearer, process.env.CRON_SECRET)) return NextResponse.json({ ok: false }, { status: 401 });
  // Monitorings first (each due run queues its discovery or captures), then the captures of every active X-ray.
  const runs = await queueDueMonitors(adminClient());
  const queued = await queueDueCaptures(adminClient());
  console.info(JSON.stringify({ service: "cron_extract", runs, queued }));
  return NextResponse.json({ ok: true, queued, runs });
}
