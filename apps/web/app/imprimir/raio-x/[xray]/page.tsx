// /imprimir/raio-x/[xray]?t=: P23 as worker-render prints it into the "Baixar PDF" file (Marlon, 07/nov: the PDF is the
// result screen printed). No portal session: the page opens only with the one-time token worker-render minted for this
// run (xray_print_token, sha256, 5 minutes, used once); anything else is 404. Same component and numbers as P23.
import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/flags";
import { printDeps, serviceRpc, serviceRuleParam, xrayAccountId } from "@/lib/monitor/deps";
import { loadOpportunitiesForPrint, loadResultPageForPrint, type History, type ItemLists, type MonitorSummary, type TestPlan } from "@/lib/monitor/load";
import { printTokenValid } from "@/lib/monitor/print";
import ResultView from "../../../app/raio-x/_components/ResultView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Raio-X de preço · MargoAI", robots: { index: false, follow: false } };

export default async function PrintResultPage({ params, searchParams }: { params: Promise<{ xray: string }>; searchParams: Promise<{ t?: string }> }) {
  const { xray } = await params;
  const { t } = await searchParams;
  if (!(await printTokenValid(printDeps(), xray, t))) notFound();
  const page = await loadResultPageForPrint(serviceRpc, xray);
  if (!page) notFound();
  const monitorId = page.result.monitor_id;
  const accountId = await xrayAccountId(xray);
  const [summaries, lists, history, minItems, plan, opportunities] = await Promise.all([
    monitorId ? (serviceRpc("monitor_summaries", { p_monitors: [monitorId] }) as Promise<MonitorSummary[]>) : Promise.resolve([]),
    serviceRpc("monitor_items", { p_xray: xray }) as Promise<ItemLists>,
    monitorId ? (serviceRpc("monitor_history", { p_monitor: monitorId }) as Promise<Omit<History, "picker">>) : Promise.resolve(null),
    serviceRuleParam("m1.score_min_items", 5),
    monitorId ? (serviceRpc("monitor_test_plan", { p_xray: xray }) as Promise<TestPlan | null>) : Promise.resolve(null),
    accountId ? isEnabled("m1.oportunidades_ia", accountId).then((on) => (on ? loadOpportunitiesForPrint(serviceRpc, xray) : null)) : Promise.resolve(null),
  ]);
  const summary = summaries[0];
  const runs = (history?.runs ?? []).filter((r) => ["ready", "delivered"].includes(r.status) && r.on).map((r) => ({ xray_id: r.xray_id, on: r.on as string }));
  return (
    <ResultView
      page={page}
      monitorId={monitorId ?? ""}
      storeName={summary?.store_name ?? page.result.store_name}
      everyDays={summary?.every_days ?? 7}
      onlyYours={lists?.only_yours ?? []}
      runs={runs}
      synthetic={page.result.synthetic}
      minItems={minItems}
      mode="print"
      continuity={
        monitorId
          ? { history: history?.runs ?? [], nextRunAt: summary?.next_run_at ?? null, status: summary?.status ?? "active", plan, canEdit: false, canCapture: false, competitorAllowed: false, opportunities }
          : undefined
      }
    />
  );
}
