// C09, C16 order sheet: the orders behind one difference, as CSV. Staff with a console session only;
// anyone else gets 404 (05 intro), and the difference must belong to the account in the path.
import { NextResponse } from "next/server";
import { consoleStaff } from "@/lib/console/staff";
import { canConsole } from "@/lib/permissions";
import { evidenceCsv, loadEvidence } from "@/lib/m2/evidence";
import { adminClient } from "@/lib/supabase/admin";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const staff = await consoleStaff();
  const { code, id } = await params;
  if (!staff || !canConsole(staff.role, "clients") || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("não encontrado", { status: 404 });
  const db = adminClient();
  const { data: account } = await db.from("account").select("id").eq("code", code).maybeSingle();
  const ev = account ? await loadEvidence(db, account.id, id) : null;
  if (!ev) return new NextResponse("não encontrado", { status: 404 });
  return new NextResponse(evidenceCsv(ev.rule, ev.rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pedidos-${ev.rule}-${code}.csv"`,
    },
  });
}
