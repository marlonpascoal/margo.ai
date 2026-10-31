"use server";
// P09/W05 server actions. requirePlanOwner() re-checks the portal session and the Dono role (04 §5) on
// every call; lib/billing/checkout.ts writes audit_log with the person, ip and user agent.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requirePlanOwner } from "@/lib/billing/access";
import { requestRede, startCheckout } from "@/lib/billing/checkout";
import { billingDeps } from "@/lib/billing/deps";
import { requestMeta } from "@/lib/console/request";

export type PlanActionState = { message: string | null };

/** Where Asaas sends the person back: MARGO_APP_URL on the platform, else this request's own origin. */
async function origin(): Promise<string> {
  if (process.env.MARGO_APP_URL) return process.env.MARGO_APP_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** "Assinar pelo Asaas" / "Continuar para o pagamento": to the Asaas hosted checkout (P10). */
export async function checkoutAction(_prev: PlanActionState, _form: FormData): Promise<PlanActionState> {
  const owner = await requirePlanOwner();
  const result = await startCheckout(billingDeps(), { personId: owner.personId, ...(await requestMeta()) }, owner.accountId, await origin());
  if (!result.ok) return { message: result.message };
  redirect(result.url);
}

/** "Falar com a gente": an alert for the founders (04 §7). */
export async function redeAction(_prev: PlanActionState, _form: FormData): Promise<PlanActionState> {
  const owner = await requirePlanOwner();
  return requestRede(billingDeps(), { personId: owner.personId, ...(await requestMeta()) }, owner.accountId);
}
