// W01 "Relatórios" and P08: the X-ray PDF (P01) of the account, from the private `pdf` bucket. It covers the
// whole account, so only people who see all kitchens get it (A03). The closing PDF and xlsx (P06) are served
// by /app/relatorios/fechamento/[id]/[formato], kitchen-scoped (lib/portal/account-data.ts closeFilePath).
import { notFound } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { canPortal } from "@/lib/permissions";
import { adminClient } from "@/lib/supabase/admin";
import { requireMember } from "./session";

export async function serveXrayPdf(id: string): Promise<Response> {
  const m = await requireMember();
  if (!canPortal(m.role, "see_xray") || !m.allKitchens) notFound();
  await requireFlag("m1.raio_x", m.account.id);
  const db = adminClient();
  const { data } = await db.from("xray").select("pdf_path").eq("id", id).eq("account_id", m.account.id).maybeSingle();
  if (!data?.pdf_path) notFound();
  const { data: file, error } = await db.storage.from("pdf").download(data.pdf_path);
  if (error || !file) notFound();
  return new Response(file, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="raio-x.pdf"',
      "cache-control": "private, no-store",
    },
  });
}
