// C04 Pareamento de itens (design/C04-Pareamento.dc.html, 05 §A, M1-03, M1-04). A row opens with ?item= to
// accept or reject its pairs; "Calcular raio-X" waits until every `revisar` item is reviewed or left out.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { ConsoleMain, FictitiousLabel } from "@/components/console";
import { Notice, XrayTitle, card, primaryButton, secondaryButton } from "@/components/xray";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { money } from "@/lib/xray/format";
import { pairStatusLabel, UNIT_LABEL, XRAY_MESSAGES } from "@/lib/xray/labels";
import { latestJob, loadItems, loadNeighborhood, loadPairs, loadXrayHead } from "@/lib/xray/load";
import { examplePair, neighborhoodCounts, pairingTotals, pendingReview, type ItemRow } from "@/lib/xray/view";
import { calculateAction, reviewItemAction, skipItemAction } from "../../actions";

export const metadata = { title: "Pareamento · MargoAI" };

const th = "border-b border-border px-4 py-3";
const td = "border-b border-border-subtle px-4 py-3";
const PILL: Record<string, string> = { auto: "bg-ok-bg", normalizado: "bg-sunken", revisar: "bg-warn-bg", manual: "bg-sunken" };

function PairsPanel({ xrayId, item, pairs }: { xrayId: string; item: ItemRow; pairs: Awaited<ReturnType<typeof loadPairs>> }) {
  return (
    <div className="flex flex-col gap-3 bg-bg px-4 py-3">
      <form action={reviewItemAction} className="flex flex-col gap-2" aria-label={`Pares de ${item.name}`}>
        <input type="hidden" name="xray" value={xrayId} />
        <input type="hidden" name="item" value={item.id} />
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {pairs.map((p) => (
            <li key={p.id}>
              <label className="flex flex-wrap items-center gap-2.5 text-sm">
                <input type="checkbox" name="pair" value={p.id} defaultChecked={p.accepted} />
                <b>{p.name}</b>
                <span className="text-ink-muted">{p.store}</span>
                <span className="font-mono">{money(p.priceCents)}</span>
                <span className="font-mono text-xs text-ink-faint">{Math.round(p.similarity * 100)}%</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2.5">
          <button type="submit" className={primaryButton}>
            {XRAY_MESSAGES.savePairs}
          </button>
          <Link href="?" scroll={false} className={secondaryButton}>
            Fechar
          </Link>
        </div>
      </form>
      <form action={skipItemAction}>
        <input type="hidden" name="xray" value={xrayId} />
        <input type="hidden" name="item" value={item.id} />
        <input type="hidden" name="skipped" value={item.skipped ? "false" : "true"} />
        <button type="submit" className="cursor-pointer border-0 bg-transparent p-0 text-sm text-ink underline">
          {item.skipped ? XRAY_MESSAGES.unskip : XRAY_MESSAGES.skip}
        </button>
      </form>
    </div>
  );
}

export default async function PairingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ item?: string }> }) {
  await requireConsole("clients");
  const db = adminClient();
  const x = await loadXrayHead(db, (await params).id);
  if (!x) notFound();
  await requireFlag("m1.raio_x", x.accountId);
  const { item: open } = await searchParams;
  const [items, hood, job] = await Promise.all([loadItems(db, x.id), loadNeighborhood(db, x.id), latestJob(db, "xray_pair", x.id)]);
  const pairs = open && items.some((i) => i.id === open) ? await loadPairs(db, x.id, open) : [];
  const totals = pairingTotals(items);
  const pending = pendingReview(items);
  const working = job && (job.status === "queued" || job.status === "running");
  // Drawing order: items paired alone first, the ones to review at the end.
  const rows = [...items].sort((a, b) => Number(a.pairStatus === "revisar") - Number(b.pairStatus === "revisar") || a.name.localeCompare(b.name, "pt-BR"));

  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <XrayTitle
          code="C04"
          step={3}
          store={x.storeName}
          title="Pareamento de itens"
          lead={`Cada item do cardápio contra os itens parecidos das ${neighborhoodCounts(hood).inSet} lojas. Item vendido por peso ou em pacote é normalizado antes de comparar.`}
        />
        <form action={calculateAction} className="flex flex-wrap items-center gap-2.5">
          {x.synthetic && <FictitiousLabel />}
          <input type="hidden" name="xray" value={x.id} />
          <button type="submit" className={primaryButton} disabled={pending > 0 || items.length === 0 || !!working}>
            Calcular raio-X
          </button>
        </form>
      </div>
      {working && <Notice>{XRAY_MESSAGES.pairingPending}</Notice>}
      {job?.status === "failed" && <Notice tone="danger">{XRAY_MESSAGES.jobFailed}</Notice>}
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full border border-border bg-surface px-3 py-1.5">{totals.items} itens no cardápio</span>
        <span className="rounded-full border border-ok-border bg-ok-bg px-3 py-1.5">{totals.auto} pareados sozinhos</span>
        <span className="rounded-full border border-warn-border bg-warn-bg px-3 py-1.5">{totals.review} para revisar</span>
        <span className="rounded-full border border-dashed border-ink-faint bg-surface px-3 py-1.5">{totals.normalized} normalizados por peso</span>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[760px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              <th className={th}>Seu item</th>
              <th className={th}>Comparáveis</th>
              <th className={th}>Unidade</th>
              <th className={th}>Exemplo de par</th>
              <th className={th}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <Fragment key={i.id}>
                <tr id={`item-${i.id}`} data-item={i.name}>
                  <td className={`${td} font-semibold`}>
                    <Link href={`?item=${i.id}#item-${i.id}`} scroll={false} className="text-ink">
                      {i.name}
                    </Link>
                  </td>
                  <td className={`${td} font-mono`}>{i.comparables}</td>
                  <td className={td}>
                    {UNIT_LABEL[i.normUnit] ?? i.normUnit}
                    {(i.normUnit === "100g" || i.normUnit === "100ml") && <div className="font-mono text-xs text-ink-muted">{money(i.normPriceCents)}</div>}
                  </td>
                  <td className={`${td} text-ink-muted`}>{examplePair(i, money)}</td>
                  <td className={td}>
                    <span className={`rounded-full px-2.5 py-0.75 text-xs ${PILL[i.pairStatus]}`}>{pairStatusLabel(i.pairStatus, i.pairNote)}</span>
                    {(i.skipped || i.reviewed) && (
                      <span className="ml-2 font-mono text-xs text-ink-muted">{i.skipped ? XRAY_MESSAGES.skipped : XRAY_MESSAGES.reviewed}</span>
                    )}
                  </td>
                </tr>
                {open === i.id && (
                  <tr>
                    <td colSpan={5} className="border-b border-border-subtle p-0">
                      <PairsPanel xrayId={x.id} item={i} pairs={pairs} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </ConsoleMain>
  );
}
