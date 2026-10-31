// C18: a branded P06 rendered by render_close_bpo, for the founder to drop in the partner's folder. Staff only;
// anyone else gets 404 (05 intro).
import { NextResponse } from "next/server";
import { bpoPdfPath } from "@/lib/console/bpo";
import { consoleStaff } from "@/lib/console/staff";
import { canConsole } from "@/lib/permissions";
import { adminClient } from "@/lib/supabase/admin";

const notFound = () => new NextResponse("não encontrado", { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ job: string }> }) {
  const staff = await consoleStaff();
  const { job: jobId } = await params;
  if (!staff || !canConsole(staff.role, "clients") || !/^[0-9a-f-]{36}$/.test(jobId)) return notFound();
  const db = adminClient();
  const { data: job } = await db.from("job").select("status, payload").eq("id", jobId).eq("type", "render_close_bpo").maybeSingle();
  if (!job || job.status !== "done") return notFound();
  const payload = job.payload as { close_period_id?: string; bpo_partner_id?: string };
  const { data: close } = await db.from("close_period").select("month, account(code)").eq("id", payload.close_period_id ?? "").maybeSingle();
  if (!close?.account || !payload.bpo_partner_id) return notFound();
  const ym = close.month.slice(0, 7);
  const { data } = await db.storage.from("closes").download(bpoPdfPath(payload.bpo_partner_id, close.account.code, ym));
  if (!data) return notFound();
  return new NextResponse(await data.arrayBuffer(), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="fechamento-${close.account.code}-${ym}.pdf"` },
  });
}
