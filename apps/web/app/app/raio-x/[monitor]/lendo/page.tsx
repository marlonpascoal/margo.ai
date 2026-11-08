// P21 (phone) / W12 (computer): "Lendo os cardápios", the waiting screen (draft §2.5). The first paint comes from the
// server; Lendo.tsx then polls GET /api/raio-x/[monitor]/progress every 15 s while visible and 60 s hidden. When the
// run is calculated it opens P22 (doubts left) or P23. Never names blocks, captchas or iFood defenses.
import { notFound, redirect } from "next/navigation";
import { loadDeps } from "@/lib/monitor/deps";
import { loadDoubts, loadMonitorSummary, loadPartial, loadProgress, paceInput } from "@/lib/monitor/load";
import { etaRange, etaText, isSlow } from "@/lib/monitor/rules";
import { dayMon, hourMin } from "@/lib/monitor/view";
import { requirePortal } from "@/lib/portal/session";
import Lendo from "../../_components/Lendo";
import { Crumb, Fict, Head } from "../../_components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lendo os cardápios · MargoAI" };

export default async function WaitingPage({ params }: { params: Promise<{ monitor: string }> }) {
  const { monitor } = await params;
  const m = await requirePortal({ action: "see_xray", flags: ["m1.portal"] });
  const deps = loadDeps(m.db);
  const [summary, progress] = await Promise.all([loadMonitorSummary(deps, monitor), loadProgress(deps, monitor)]);
  if (!summary || !progress) notFound();
  if (progress.step === "ready") {
    const doubts = await loadDoubts(deps, monitor, progress.xray_id);
    redirect(doubts && doubts.asked && doubts.open > 0 ? `/app/raio-x/${monitor}/revisar` : `/app/raio-x/${monitor}`);
  }
  const partial = await loadPartial(deps, monitor, progress.xray_id);
  const { data: radius } = await m.db.from("xray").select("radius_km").eq("id", progress.xray_id).maybeSingle();
  const input = paceInput(progress);
  const eta = etaRange(input);
  const last = summary.last_ready && summary.last_ready.xray_id !== progress.xray_id ? summary.last_ready : null;
  const name = summary.store_name ?? "Loja";
  return (
    <main className="rx-main">
      <Crumb>{name}</Crumb>
      <Head title="Lendo os cardápios" lead={`${name} · raio de ${radius?.radius_km ?? 3} km · começou às ${hourMin(progress.created_at)}`}>
        <Fict synthetic={m.account.isSynthetic} />
      </Head>
      <Lendo
        monitorId={monitor}
        own={summary.target_kind === "own"}
        storeName={name}
        radiusKm={radius?.radius_km ?? 3}
        initial={{ ...progress, eta, etaText: etaText(eta), slow: isSlow(input) }}
        partial={partial}
        lastResult={last ? { label: dayMon(last.on) } : null}
      />
    </main>
  );
}
