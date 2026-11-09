// P23 / W14 server part shared by /app/raio-x/[monitor] (newest calculated run) and /app/raio-x/[monitor]/[xray] (a past
// one). Nothing calculated yet: to P21. Not visible to this person: 404 (A02, A03).
import { notFound, redirect } from "next/navigation";
import { loadDeps } from "@/lib/monitor/deps";
import { canAnswerDoubts, canManageMonitors } from "@/lib/monitor/rules";
import { isEnabled } from "@/lib/flags";
import { loadHistory, loadItemLists, loadMonitorSummary, loadOpportunities, loadResultPage, loadTestPlan, scoreMinItems, visibleMonitor, type Limits } from "@/lib/monitor/load";
import { requirePortal } from "@/lib/portal/session";
import ResultView from "./ResultView";

export default async function ResultPageServer({ monitorId, xrayId }: { monitorId: string; xrayId?: string }) {
  const m = await requirePortal({ action: "see_xray", flags: ["m1.portal"] });
  const deps = loadDeps(m.db);
  const row = await visibleMonitor(deps, monitorId);
  if (!row) notFound();
  const page = await loadResultPage(deps, monitorId, xrayId);
  if (!page) {
    if (xrayId) notFound();
    redirect(`/app/raio-x/${monitorId}/lendo`);
  }
  const [summary, lists, history, minItems, plan, limits, opportunities, manualCapture] = await Promise.all([
    loadMonitorSummary(deps, monitorId),
    loadItemLists(deps, monitorId, page.result.xray_id),
    loadHistory(deps, monitorId),
    scoreMinItems(m.db),
    loadTestPlan(deps, monitorId, page.result.xray_id),
    deps.rpc("monitor_limits", { p_account: m.account.id, p_env: deps.env }) as Promise<Limits>,
    isEnabled("m1.oportunidades_ia", m.account.id).then((on) => (on ? loadOpportunities(deps, monitorId, page.result.xray_id) : null)),
    isEnabled("m1.captura_manual", m.account.id),
  ]);
  const canEdit = canAnswerDoubts(m.role, { gerenteAnswers: limits.gerente_answers, monitorKitchenId: row.kitchenId, kitchenIds: m.kitchenIds, allKitchens: m.allKitchens });
  const runs = (history?.runs ?? []).filter((r) => ["ready", "delivered"].includes(r.status) && r.on).map((r) => ({ xray_id: r.xray_id, on: r.on as string }));
  return (
    <ResultView
      page={page}
      monitorId={monitorId}
      storeName={summary?.store_name ?? page.result.store_name}
      everyDays={row.everyDays}
      onlyYours={lists?.only_yours ?? []}
      runs={runs}
      synthetic={m.account.isSynthetic}
      minItems={minItems}
      mode="screen"
      continuity={{
        history: history?.runs ?? [],
        nextRunAt: summary?.next_run_at ?? null,
        status: summary?.status ?? "active",
        plan,
        canEdit,
        canCapture: manualCapture && canManageMonitors(m.role) && summary?.status === "active",
        competitorAllowed: limits.competitor_allowed,
        opportunities,
      }}
    />
  );
}
