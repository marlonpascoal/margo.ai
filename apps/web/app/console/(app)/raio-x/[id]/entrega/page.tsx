// C06 Entrega ao dono (design/C06-Entrega.dc.html, 05 §A, P01, P02). The message carries the sign-up link
// with the X-ray reference (D29, P07); WhatsApp is sent by hand (D36); hours go to time_log.
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ConsoleMain } from "@/components/console";
import { Notice, XrayTitle, card, secondaryButton } from "@/components/xray";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { hoursLabel } from "@/lib/xray/format";
import { XRAY_MESSAGES } from "@/lib/xray/labels";
import { latestJob, loadItems, loadMinutes, loadNeighborhood, loadXrayHead } from "@/lib/xray/load";
import { signupLink, xrayMessage } from "@/lib/xray/P02-whatsapp-raio-x";
import { neighborhoodCounts, xrayResult } from "@/lib/xray/view";
import DeliveryForm from "./DeliveryForm";

export const metadata = { title: "Entrega ao dono · MargoAI" };

async function origin(): Promise<string> {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const x = await loadXrayHead(db, (await params).id);
  if (!x) notFound();
  await requireFlag("m1.raio_x", x.accountId);
  const [items, hood, job, minutes] = await Promise.all([
    loadItems(db, x.id),
    loadNeighborhood(db, x.id),
    latestJob(db, "render_xray", x.id),
    loadMinutes(db, x.id, staff.personId),
  ]);
  const r = xrayResult(items);
  const store = x.storeName ?? "";
  const message = xrayMessage({
    storeName: store,
    storesCompared: neighborhoodCounts(hood).inSet,
    radiusKm: x.radiusKm,
    itemsToRaise: r.toRaise,
    link: signupLink(await origin(), x.id),
  });
  const rendering = job && (job.status === "queued" || job.status === "running");
  const hours = (m: number | undefined) => (m === undefined ? "" : hoursLabel(m));

  return (
    <ConsoleMain>
      <XrayTitle code="C06" store={store} title="Entrega ao dono" />
      <div className="flex flex-wrap items-start gap-5">
        <div className={`${card} flex flex-[1_1_300px] flex-col gap-3 p-4`}>
          <div className="font-bold">O arquivo</div>
          <div className="box-border flex h-[260px] flex-col gap-2 rounded-sm border border-border bg-bg p-4" aria-hidden="true">
            <span className="font-mono text-2xs text-ink-muted">PDF · A4 · 2 páginas</span>
            <span className="text-lg font-bold">{store}: raio-X de preço</span>
            <span className="h-2.5 w-4/5 rounded-[2px] bg-border" />
            <span className="h-2.5 w-[65%] rounded-[2px] bg-border" />
            <span className="h-[60px] w-full rounded-xs bg-ok-bg" />
            <span className="h-10 w-full rounded-xs bg-danger-bg" />
          </div>
          {x.pdfPath && !rendering ? (
            <a href={`/console/raio-x/${x.id}/pdf`} target="_blank" rel="noopener" className={secondaryButton}>
              Abrir o PDF
            </a>
          ) : (
            <Notice>{rendering ? XRAY_MESSAGES.pdfPending : XRAY_MESSAGES.pdfMissing}</Notice>
          )}
          {!x.pdfPath && !rendering && (
            <Link href={`/console/raio-x/${x.id}`} className="text-sm">
              Raio-X de preço
            </Link>
          )}
        </div>
        <DeliveryForm
          xrayId={x.id}
          message={message}
          hours={{ vizinhanca: hours(minutes.vizinhanca), pareamento: hours(minutes.pareamento), entrega: hours(minutes.entrega) }}
        />
      </div>
    </ConsoleMain>
  );
}
