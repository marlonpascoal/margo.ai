// The notice e-mail as the owner's mail client gets it (raw HTML), for the console preview's frame and the
// F02 screenshots of E01 and E02. Staff only; anyone else gets 404 (05 intro).
import { NextResponse } from "next/server";
import { EXAMPLES } from "@/emails";
import { consoleStaff } from "@/lib/console/staff";
import { canConsole } from "@/lib/permissions";
import { previewRecipient } from "@/lib/notify/preview";
import { renderEmail } from "@/emails/layout";
import type { NoticeCode } from "@/lib/notify/templates";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const staff = await consoleStaff();
  const { code } = await params;
  if (!staff || !canConsole(staff.role, "clients") || !(code in EXAMPLES)) return new NextResponse("não encontrado", { status: 404 });
  const m = renderEmail(EXAMPLES[code as NoticeCode], previewRecipient, { synthetic: true });
  return new NextResponse(m.html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
