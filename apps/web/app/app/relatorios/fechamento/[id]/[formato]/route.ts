// P06 downloads for the owner (05 §C, W01 reports): the closing PDF or xlsx of one close_period. Every
// profile may see the close (04 §5), scoped to their kitchens (A03): anything else answers 404.
import { canPortal } from "@/lib/permissions";
import { portalMember } from "@/lib/portal/account-access";
import { closeFilePath, storageFile } from "@/lib/portal/account-data";
import { adminClient } from "@/lib/supabase/admin";

const TYPE = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as const;
const notFound = () => new Response("Não encontrado", { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; formato: string }> }) {
  const m = await portalMember();
  if (!m) return Response.redirect(new URL("/entrar", _req.url), 303);
  const { id, formato } = await params;
  if (!canPortal(m.role, "see_close") || (formato !== "pdf" && formato !== "xlsx") || !/^[0-9a-f-]{36}$/.test(id)) return notFound();
  const db = adminClient();
  const path = await closeFilePath(db, m.account.id, m, id, formato);
  const file = path ? await storageFile(db, path) : null;
  if (!path || !file) return notFound();
  return new Response(file, {
    headers: {
      "content-type": TYPE[formato],
      "content-disposition": `attachment; filename="${path.split("/").pop()}"`,
      "cache-control": "private, no-store",
    },
  });
}
