"use server";
// P03 "Abrir o Portal do Parceiro" with the terms checkbox: the Dono accepts the authorization for the
// CNPJs (D21, D48), then goes to the iFood Partner Portal to press "Permitir". Dono only (the authorization
// is signed by the legal representative or whom they indicate, docs/legal/autorizacao-dados.md).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestMeta } from "@/lib/console/request";
import { requirePortal } from "@/lib/portal/account-access";
import { PARTNER_PORTAL_URL, signAuthorization } from "@/lib/portal/connect";
import { adminClient } from "@/lib/supabase/admin";

const PATH = "/app/conectar";

export async function acceptTermsAction(form: FormData): Promise<void> {
  const m = await requirePortal({ roles: ["dono"], flags: ["m2.ifood_api", "m2.extensao_chrome"] });
  if (form.get("autorizo") !== "on") redirect(`${PATH}?aviso=${encodeURIComponent("Marque a autorização para continuar.")}`);
  const companies = form.getAll("cnpj").map(String);
  const written = await signAuthorization(adminClient(), { personId: m.personId, accountId: m.account.id }, companies, await requestMeta());
  revalidatePath(PATH);
  if (!written.length) redirect(`${PATH}?aviso=${encodeURIComponent("Escolha o CNPJ que você autoriza.")}`);
  redirect(PARTNER_PORTAL_URL);
}
