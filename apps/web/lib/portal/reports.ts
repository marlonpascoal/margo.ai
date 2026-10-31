// W01 "Relatórios" and P08: the closing PDF (P06) and the X-ray PDF (P01) of the account, from the private
// `pdf` bucket. Both cover the whole account, so only people who see all kitchens get them (A03).
import { notFound } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { canPortal } from "@/lib/permissions";
import { adminClient } from "@/lib/supabase/admin";
import { requireMember } from "./session";

export async function servePortalPdf(kind: "close" | "xray", id: string): Promise<Response> {
  const m = await requireMember();
  if (!canPortal(m.role, kind === "close" ? "see_close" : "see_xray") || !m.allKitchens) notFound();
  if (kind === "xray") await requireFlag("m1.raio_x", m.account.id);
  const db = adminClient();
  const { data } =
    kind === "close"
      ? await db.from("close_period").select("pdf_path").eq("id", id).eq("account_id", m.account.id).is("kitchen_id", null).maybeSingle()
      : await db.from("xray").select("pdf_path").eq("id", id).eq("account_id", m.account.id).maybeSingle();
  if (!data?.pdf_path) notFound();
  const { data: file, error } = await db.storage.from("pdf").download(data.pdf_path);
  if (error || !file) notFound();
  return new Response(file, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${kind === "close" ? "fechamento" : "raio-x"}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
