// E06, W09 "Baixar todos os meus dados": the export zip built by worker-account (job account_export).
// Dono only (the zip holds every kitchen and every person of the account, 04 §5); anything else 404.
import { canPortal } from "@/lib/permissions";
import { portalMember } from "@/lib/portal/account-access";
import { exportPath, storageFile } from "@/lib/portal/account-data";
import { adminClient } from "@/lib/supabase/admin";

const notFound = () => new Response("Não encontrado", { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const m = await portalMember();
  if (!m) return Response.redirect(new URL("/entrar", req.url), 303);
  const { job } = await params;
  if (!canPortal(m.role, "delete_account") || !/^[0-9a-f-]{36}$/.test(job)) return notFound();
  const db = adminClient();
  const path = await exportPath(db, m.account.id, job);
  const file = path ? await storageFile(db, path) : null;
  if (!path || !file) return notFound();
  return new Response(file, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="margoai-dados-${m.account.code}.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
