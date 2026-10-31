// P01 served to staff: the PDF worker-render saved in the private `pdf` bucket (02 §1). Same checks as the
// pages: console role (404 otherwise) and the m1.raio_x flag for the X-ray's account.
import { notFound } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { loadXrayHead } from "@/lib/xray/load";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireConsole("clients");
  const db = adminClient();
  const x = await loadXrayHead(db, (await params).id);
  if (!x?.pdfPath) notFound();
  await requireFlag("m1.raio_x", x.accountId);
  const { data, error } = await db.storage.from("pdf").download(x.pdfPath);
  if (error || !data) notFound();
  const name = (x.storeName ?? "loja").normalize("NFD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase();
  return new Response(data, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="raio-x-${name}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
