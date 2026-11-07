// GET /api/raio-x/[monitor]/progress (draft §2.5): what P21, the P19 row and C22 poll, every 15 s while visible and
// 60 s hidden. The member's own RLS read decides the monitoring is visible (A02, A03); otherwise 404. Adds the time
// range and the "slow" flag computed by lib/monitor/rules.ts. Never names blocks, captchas or iFood.
import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/flags";
import { loadDeps } from "@/lib/monitor/deps";
import { loadProgress, paceInput } from "@/lib/monitor/load";
import { etaRange, etaText, isSlow } from "@/lib/monitor/rules";
import { canPortal } from "@/lib/permissions";
import { portalMember } from "@/lib/portal/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ monitor: string }> }) {
  const m = await portalMember();
  const notFound = NextResponse.json({ error: "not found" }, { status: 404 });
  if (!m || !canPortal(m.role, "see_xray") || !(await isEnabled("m1.portal", m.account.id))) return notFound;
  const { monitor } = await ctx.params;
  const xray = new URL(req.url).searchParams.get("raio-x") ?? undefined;
  const p = await loadProgress(loadDeps(m.db), monitor, xray);
  if (!p) return notFound;
  const input = paceInput(p);
  const eta = etaRange(input);
  return NextResponse.json(
    { ...p, eta, etaText: etaText(eta), slow: isSlow(input) },
    { headers: { "cache-control": "private, no-store" } },
  );
}
