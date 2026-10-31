// P09 / W05 Plano e cobrança (design/P09-Plano.dc.html phone, design/W05-Plano.dc.html computer; 05 P09/W05,
// P10, 04 §7). Dono only, checked here server-side; the portal shell is not this page's permission check.
import { requirePortal } from "@/lib/portal/session";
import { loadPlanView } from "@/lib/billing/view";
import { adminClient } from "@/lib/supabase/admin";
import PlanScreen from "./PlanScreen";

export const metadata = { title: "Plano e cobrança · MargoAI" };
export const dynamic = "force-dynamic";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const owner = await requirePortal({ action: "billing" });
  const status = (await searchParams).status;
  const view = await loadPlanView(adminClient(), owner.account.id, typeof status === "string" ? status : null, new Date());
  return <PlanScreen view={view} />;
}
