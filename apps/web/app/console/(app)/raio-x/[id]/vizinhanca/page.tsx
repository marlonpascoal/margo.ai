// C03 Vizinhança (design/C03-Vizinhanca.dc.html, 05 §A, M1-01, M1-02). While the discovery runs, or after
// it stopped, the page says so with the reason. The captures of this X-ray's stores are counted, and "Confirmar" waits
// for them on the server too (xray_confirm_stores); the page re-reads itself while they run (D47b).
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ConsoleMain } from "@/components/console";
import { Notice, XrayTitle } from "@/components/xray";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { captureProgressLabel, collectStopReason, targetCaptureFailed, targetCaptureRetry, XRAY_MESSAGES } from "@/lib/xray/labels";
import { captureProgress, captureRetries, latestJob, loadNeighborhood, loadXrayHead } from "@/lib/xray/load";
import { captureCounts } from "@/lib/xray/view";
import NeighborhoodView from "./NeighborhoodView";

export const metadata = { title: "Vizinhança · MargoAI" };

export default async function NeighborhoodPage({ params }: { params: Promise<{ id: string }> }) {
  await requireConsole("clients");
  const db = adminClient();
  const x = await loadXrayHead(db, (await params).id);
  if (!x) notFound();
  await requireFlag("m1.raio_x", x.accountId);
  const [{ states, blocker }, retries] = await Promise.all([captureProgress(db, x.id), captureRetries(db, x.id)]);
  const [rows, collect, discover] = await Promise.all([loadNeighborhood(db, x.id, states, retries), latestJob(db, "collect", x.id), latestJob(db, "extract_discover", x.id)]);
  const counts = captureCounts(states);
  const targetFailed = states.some((c) => c.is_target && c.state === "failed");
  const targetRetryAt = x.targetStoreId ? retries.get(x.targetStoreId) : undefined;
  const job = discover ?? collect;
  const title = <XrayTitle code="C03" step={2} store={x.storeName} title={`Vizinhança de ${x.radiusKm} km`} />;
  if (rows.length === 0) {
    const failed = job?.status === "failed";
    return (
      <ConsoleMain>
        {title}
        <Notice tone={failed ? "danger" : "muted"}>
          {failed ? collectStopReason(job.error, job.reason) : job?.status === "running" || discover?.status === "done" ? XRAY_MESSAGES.collectRunning : XRAY_MESSAGES.collectQueued}
        </Notice>
      </ConsoleMain>
    );
  }
  return (
    <ConsoleMain>
      {blocker ? <AutoRefresh everyMs={10_000} /> : null}
      {counts.total > 0 ? <Notice tone="muted">{captureProgressLabel(counts)}</Notice> : null}
      {blocker === "neighborhood" ? <Notice tone="muted">{XRAY_MESSAGES.neighborhoodPending}</Notice> : null}
      {targetFailed ? <Notice tone="danger">{targetCaptureFailed(x.storeName)}</Notice> : null}
      {targetRetryAt ? <Notice tone="muted">{targetCaptureRetry(x.storeName, targetRetryAt)}</Notice> : null}
      <NeighborhoodView xrayId={x.id} title={title} rows={rows} target={x.target} radiusKm={x.radiusKm} synthetic={x.synthetic} waiting={blocker !== null} />
    </ConsoleMain>
  );
}
