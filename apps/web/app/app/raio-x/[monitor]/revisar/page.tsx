// P22 (phone) / W13 (computer): "Itens em dúvida", review by the owner (draft §2.6). M1-04: the doubts are its
// `revisar` items, the suggestion pre-marked is the candidate it ranks first. Dono and a Gerente of the monitoring's
// kitchen answer (answer_doubts, m1.portal_gerente_answers); a Financeiro only sees. The run under review is the newest
// calculated one; while nothing is calculated the page sends to P21.
import { notFound, redirect } from "next/navigation";
import { loadDeps } from "@/lib/monitor/deps";
import { latestReadyRun, loadDoubts, loadItemLists, loadMonitorSummary, visibleMonitor, type Limits } from "@/lib/monitor/load";
import { canAnswerDoubts } from "@/lib/monitor/rules";
import { dayMon } from "@/lib/monitor/view";
import { requirePortal } from "@/lib/portal/session";
import Revisar from "../../_components/Revisar";
import { Crumb, Fict, Head } from "../../_components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Itens em dúvida · MargoAI" };

export default async function ReviewPage({ params }: { params: Promise<{ monitor: string }> }) {
  const { monitor } = await params;
  const m = await requirePortal({ action: "see_xray", flags: ["m1.portal"] });
  const deps = loadDeps(m.db);
  const row = await visibleMonitor(deps, monitor);
  if (!row) notFound();
  const xrayId = await latestReadyRun(deps, monitor);
  if (!xrayId) redirect(`/app/raio-x/${monitor}/lendo`);
  const [summary, doubts, lists, limits] = await Promise.all([
    loadMonitorSummary(deps, monitor),
    loadDoubts(deps, monitor, xrayId),
    loadItemLists(deps, monitor, xrayId),
    deps.rpc("monitor_limits", { p_account: m.account.id, p_env: deps.env }) as Promise<Limits>,
  ]);
  if (!summary || !doubts || !lists) notFound();
  const canAnswer = canAnswerDoubts(m.role, { gerenteAnswers: limits.gerente_answers, monitorKitchenId: row.kitchenId, kitchenIds: m.kitchenIds, allKitchens: m.allKitchens });
  const name = summary.store_name ?? "Loja";
  const on = summary.last_ready?.xray_id === xrayId ? summary.last_ready.on : null;
  return (
    <main className="rx-main">
      <Crumb>{name}</Crumb>
      <Head title="Itens em dúvida" lead={`Raio-X de ${on ? dayMon(on) : ""}. O resultado já está pronto sem estes itens; suas respostas o completam.`}>
        <Fict synthetic={m.account.isSynthetic} />
      </Head>
      <Revisar monitorId={monitor} xrayId={xrayId} doubts={doubts} lists={lists} canAnswer={canAnswer} />
    </main>
  );
}
