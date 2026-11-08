// P23 / W14 server part shared by /app/raio-x/[monitor] (newest calculated run) and /app/raio-x/[monitor]/[xray] (a past
// one). Nothing calculated yet: to P21. Not visible to this person: 404 (A02, A03).
import { notFound, redirect } from "next/navigation";
import { loadDeps } from "@/lib/monitor/deps";
import { loadHistory, loadItemLists, loadMonitorSummary, loadResultPage, scoreMinItems, visibleMonitor } from "@/lib/monitor/load";
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
  const [summary, lists, history, minItems] = await Promise.all([
    loadMonitorSummary(deps, monitorId),
    loadItemLists(deps, monitorId, page.result.xray_id),
    loadHistory(deps, monitorId),
    scoreMinItems(m.db),
  ]);
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
    />
  );
}
