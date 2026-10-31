// C03 Vizinhança (design/C03-Vizinhanca.dc.html, 05 §A, M1-01, M1-02). While the collection runs, or after
// it stopped, the page says so with the reason (D47).
import { notFound } from "next/navigation";
import { ConsoleMain } from "@/components/console";
import { Notice, XrayTitle } from "@/components/xray";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { collectStopReason, XRAY_MESSAGES } from "@/lib/xray/labels";
import { latestJob, loadNeighborhood, loadXrayHead } from "@/lib/xray/load";
import NeighborhoodView from "./NeighborhoodView";

export const metadata = { title: "Vizinhança · MargoAI" };

export default async function NeighborhoodPage({ params }: { params: Promise<{ id: string }> }) {
  await requireConsole("clients");
  const db = adminClient();
  const x = await loadXrayHead(db, (await params).id);
  if (!x) notFound();
  await requireFlag("m1.raio_x", x.accountId);
  const [rows, job] = await Promise.all([loadNeighborhood(db, x.id), latestJob(db, "collect", x.id)]);
  const title = <XrayTitle code="C03" step={2} store={x.storeName} title={`Vizinhança de ${x.radiusKm} km`} />;
  if (rows.length === 0) {
    const failed = job?.status === "failed";
    return (
      <ConsoleMain>
        {title}
        <Notice tone={failed ? "danger" : "muted"}>
          {failed ? collectStopReason(job.error, job.reason) : job?.status === "running" ? XRAY_MESSAGES.collectRunning : XRAY_MESSAGES.collectQueued}
        </Notice>
      </ConsoleMain>
    );
  }
  return (
    <ConsoleMain>
      <NeighborhoodView xrayId={x.id} title={title} rows={rows} target={x.target} radiusKm={x.radiusKm} synthetic={x.synthetic} />
    </ConsoleMain>
  );
}
