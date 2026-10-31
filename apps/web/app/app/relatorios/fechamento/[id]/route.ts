// P06 closing PDF for the owner (W01, P08). Checks in servePortalPdf.
import { servePortalPdf } from "@/lib/portal/reports";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return servePortalPdf("close", (await params).id);
}
