"use server";
// P12/W03 buttons (04 §3, D30). Dono, Financeiro and Gerente (own kitchens) may mark (04 §5 "Ver e marcar
// contestações"), behind m2.contestacao. Status moves only through public.contestation_mark (actor person),
// which refuses any other transition and writes audit_log.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestMeta } from "@/lib/console/request";
import { requirePortal } from "@/lib/portal/account-access";
import { markOwnerContestation } from "@/lib/portal/contestacoes";
import { adminClient } from "@/lib/supabase/admin";

const PATH = "/app/contestacoes";

export async function markContestationAction(form: FormData): Promise<void> {
  const m = await requirePortal({ action: "contestations", flags: ["m2.contestacao"] });
  const protocol = String(form.get("protocolo") ?? "").slice(0, 60);
  const r = await markOwnerContestation(
    adminClient(),
    m.account.id,
    m,
    m.personId,
    String(form.get("contestacao") ?? ""),
    String(form.get("evento") ?? ""),
    protocol || null,
    await requestMeta(),
  );
  revalidatePath(PATH);
  // Not drawn: the status had already moved (another person marked it first).
  redirect(r.ok ? PATH : `${PATH}?aviso=${encodeURIComponent("Essa contestação já mudou. Confira a lista de novo.")}`);
}
