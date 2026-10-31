// Daily billing jobs (04 §7, §9, D37) from Vercel Cron (02 §4.3, vercel.json). Vercel sends
// `Authorization: Bearer <CRON_SECRET>`; anything else gets 401. A missing CRON_SECRET refuses everything.
import { NextResponse, type NextRequest } from "next/server";
import { billingDeps } from "@/lib/billing/deps";
import { runBillingDaily } from "@/lib/billing/jobs";
import { tokenMatches } from "@/lib/billing/webhook";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!tokenMatches(bearer, process.env.CRON_SECRET)) return NextResponse.json({ ok: false }, { status: 401 });
  const out = await runBillingDaily(billingDeps());
  const summary = {
    returned_to_free: out.trial.returnedToFree.length,
    reminded: out.trial.reminded.length,
    units_changed: out.units.changed.length,
    pilot_charged: out.pilots.charged.length,
    pilot_failed: out.pilots.failed.length,
  };
  console.info(JSON.stringify({ service: "cron_billing", ...summary }));
  return NextResponse.json({ ok: true, ...summary });
}
