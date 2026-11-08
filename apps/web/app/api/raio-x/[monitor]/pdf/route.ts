// P23 "Baixar PDF" (Marlon, 07/nov: the PDF is the result screen printed). The person's own RLS read decides the
// monitoring and the run are visible (A02, A03), with see_xray and m1.portal; otherwise 404.
//   POST                 the printed copy of this result version, or a render_xray print job (audited); {state}
//   GET ?estado=1        {state: "ready" | "preparing"} while the button waits
//   GET                  the PDF as a download, once printed (private pdf bucket, served after the checks above)
import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/flags";
import { loadDeps, printDeps, printedPdf } from "@/lib/monitor/deps";
import { loadResult } from "@/lib/monitor/load";
import { pdfFileName, requestPrint } from "@/lib/monitor/print";
import { canPortal } from "@/lib/permissions";
import { auditPerson, portalMember } from "@/lib/portal/session";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

async function visibleResult(req: Request, monitor: string) {
  const m = await portalMember();
  if (!m || !canPortal(m.role, "see_xray") || !(await isEnabled("m1.portal", m.account.id))) return null;
  const xray = new URL(req.url).searchParams.get("raio-x") ?? undefined;
  const result = await loadResult(loadDeps(m.db), monitor, xray);
  return result ? { m, result } : null;
}

export async function POST(req: Request, ctx: { params: Promise<{ monitor: string }> }) {
  const v = await visibleResult(req, (await ctx.params).monitor);
  if (!v) return notFound();
  const s = await requestPrint(printDeps(), { xrayId: v.result.xray_id, version: v.result.version, accountId: v.m.account.id });
  if (s.state === "preparing" && !s.deduped) {
    await auditPerson(adminClient(), v.m, { action: "xray.print_request", entity: "xray", entityId: v.result.xray_id, after: { version: v.result.version, job_id: s.jobId } });
  }
  return NextResponse.json({ state: s.state }, { headers: { "cache-control": "private, no-store" } });
}

export async function GET(req: Request, ctx: { params: Promise<{ monitor: string }> }) {
  const v = await visibleResult(req, (await ctx.params).monitor);
  if (!v) return notFound();
  const done = await printDeps().printed(v.result.xray_id, v.result.version);
  if (new URL(req.url).searchParams.has("estado")) return NextResponse.json({ state: done ? "ready" : "preparing" }, { headers: { "cache-control": "private, no-store" } });
  if (!done) return NextResponse.json({ state: "preparing" }, { status: 202, headers: { "cache-control": "private, no-store" } });
  const file = await printedPdf(done.path);
  if (!file) return notFound();
  return new Response(file, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${pdfFileName(v.result.store_name, v.result.on)}"`,
      "cache-control": "private, no-store",
    },
  });
}
