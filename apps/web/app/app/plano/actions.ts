"use server";
// P09/W05 server actions. requirePortal({ action: "billing" }) re-checks the portal session, the account
// (margo_conta cookie or chooser) and the Dono role (04 §5) on every call; lib/billing/checkout.ts writes
// audit_log with the person, ip and user agent.
import { redirect } from "next/navigation";
import { requestRede, startCheckout } from "@/lib/billing/checkout";
import { billingDeps } from "@/lib/billing/deps";
import { requestMeta } from "@/lib/console/request";
import { appOrigin, requirePortal } from "@/lib/portal/session";

export type PlanActionState = { message: string | null };

/** "Assinar pelo Asaas" / "Continuar para o pagamento": to the Asaas hosted checkout (P10). */
export async function checkoutAction(_prev: PlanActionState, _form: FormData): Promise<PlanActionState> {
  const owner = await requirePortal({ action: "billing" });
  const result = await startCheckout(billingDeps(), { personId: owner.personId, ...(await requestMeta()) }, owner.account.id, await appOrigin());
  if (!result.ok) return { message: result.message };
  redirect(result.url);
}

/** "Falar com a gente": an alert for the founders (04 §7). */
export async function redeAction(_prev: PlanActionState, _form: FormData): Promise<PlanActionState> {
  const owner = await requirePortal({ action: "billing" });
  return requestRede(billingDeps(), { personId: owner.personId, ...(await requestMeta()) }, owner.account.id);
}
