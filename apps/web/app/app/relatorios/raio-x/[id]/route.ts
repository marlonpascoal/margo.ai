// P01 X-ray PDF for the owner (W01, P08). Checks in serveXrayPdf.
import { serveXrayPdf } from "@/lib/portal/reports";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveXrayPdf((await params).id);
}
