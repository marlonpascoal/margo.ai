// C05 Raio-X de preço (design/C05-RaioX.dc.html, 05 §A, M1-05 to M1-08). Every number is a stored worker
// result: parity, gap and reading per item, and the Pareto rank and cumulative share.
import { notFound } from "next/navigation";
import { ConsoleMain, FictitiousLabel } from "@/components/console";
import { Notice, SecondaryLink, XrayTitle, card, primaryButton } from "@/components/xray";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { gapLabel, money, runDateLabel, shareLabel } from "@/lib/xray/format";
import { exclusiveLabel, fullParityLabel, READING_LABEL, TARGET_KIND_LABEL, withoutParityLabel, XRAY_MESSAGES } from "@/lib/xray/labels";
import { latestJob, loadHistory, loadItems, loadNeighborhood, loadXrayHead } from "@/lib/xray/load";
import { fullParityInfo, neighborhoodCounts, priceHistory, xrayResult } from "@/lib/xray/view";
import { prepareDeliveryAction } from "../actions";

export const metadata = { title: "Raio-X de preço · MargoAI" };

const th = "border-b border-border px-4 py-3";
const td = "border-b border-border-subtle px-4 py-3";
const num = "whitespace-nowrap text-right font-mono";
const TONE = { pode_subir: "text-ok", na_media: "text-ink-muted", nao_mexer: "text-danger" } as const;

export default async function XrayPage({ params }: { params: Promise<{ id: string }> }) {
  await requireConsole("clients");
  const db = adminClient();
  const x = await loadXrayHead(db, (await params).id);
  if (!x) notFound();
  await requireFlag("m1.raio_x", x.accountId);
  const [items, hood, job, hist] = await Promise.all([loadItems(db, x.id), loadNeighborhood(db, x.id), latestJob(db, "xray_calc", x.id), loadHistory(db, x.targetStoreId)]);
  const history = priceHistory(hist.runs, hist.prices);
  const r = xrayResult(items);
  const working = job && (job.status === "queued" || job.status === "running");
  const ready = r.analyzed > 0 && !working;
  const kpis = [
    { v: neighborhoodCounts(hood).inSet, l: `lojas comparáveis em ${x.radiusKm} km`, c: "text-ink" },
    { v: r.analyzed, l: "itens analisados", c: "text-ink" },
    { v: r.below, l: "abaixo da paridade", c: "text-ok" },
    { v: r.above, l: "acima da paridade", c: "text-danger" },
  ];

  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <XrayTitle code="C05" step={4} store={x.storeName} title="Raio-X de preço" />
        <form action={prepareDeliveryAction} className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-ink-muted" data-target-kind={x.targetKind}>
            {TARGET_KIND_LABEL[x.targetKind]}
          </span>
          {x.synthetic && <FictitiousLabel />}
          <SecondaryLink href={`/console/raio-x/${x.id}/cardapio`}>Ver cardápio</SecondaryLink>
          <SecondaryLink href={`/console/raio-x/${x.id}/pareamento`}>Rever pares</SecondaryLink>
          <input type="hidden" name="xray" value={x.id} />
          <button type="submit" className={primaryButton} disabled={!ready}>
            Preparar entrega
          </button>
        </form>
      </div>
      {working && <Notice>{XRAY_MESSAGES.calcPending}</Notice>}
      {!working && r.analyzed === 0 && <Notice>{XRAY_MESSAGES.notCalculated}</Notice>}
      {ready && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.l} className={`${card} flex flex-col gap-1 p-4`}>
                <div className={`font-mono text-3xl ${k.c}`}>{k.v}</div>
                <div className="text-sm text-ink-muted">{k.l}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-start gap-5">
            <div className={`${card} flex-[3_1_520px] overflow-x-auto`}>
              <table className="w-full min-w-[560px] border-collapse text-md">
                <thead>
                  <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                    <th className={th}>Item</th>
                    <th className={`${th} text-right`}>Seu preço</th>
                    <th className={`${th} text-right`}>Paridade</th>
                    <th className={`${th} text-right`}>Diferença</th>
                    <th className={th}>Leitura</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((i) => {
                    const full = fullParityInfo(i);
                    return (
                      <tr key={i.id} data-item={i.name}>
                        <td className={`${td} font-semibold`}>{i.name}</td>
                        <td className={`${td} ${num}`}>{money(i.ownCents)}</td>
                        <td className={`${td} ${num}`}>
                          {money(i.parityCents!)}
                          {full && <div className="text-xs font-normal text-ink-muted" data-full-parity>{fullParityLabel(full)}</div>}
                        </td>
                        <td className={`${td} ${num} font-semibold ${TONE[i.reading!]}`}>{gapLabel(i.gapPct)}</td>
                        <td className={`${td} ${TONE[i.reading!]}`}>
                          {READING_LABEL[i.reading!]}
                          {i.fullPriceRoom && <div className="text-xs text-ink-muted" data-full-price-room>{XRAY_MESSAGES.fullPriceRoom}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={`${card} flex flex-[2_1_320px] flex-col gap-2.5 p-4`} data-pareto>
              <div className="font-bold">
                {r.paretoCount} de {r.analyzed} itens somam 80% da perda por preço
              </div>
              {r.pareto.map((b) => (
                <div key={b.name} className="grid grid-cols-[130px_minmax(0,1fr)_40px] items-center gap-2.5 text-sm">
                  <span>{b.name}</span>
                  <div className="h-3 rounded-[3px] bg-sunken">
                    <div className="h-3 rounded-[3px] bg-danger" style={{ width: `${b.width}%` }} />
                  </div>
                  <span className="text-right font-mono text-ink-muted">{shareLabel(b.cumShare)}</span>
                </div>
              ))}
              <div className="border-t border-border-subtle pt-2.5 text-xs text-ink-muted">
                Paridade = mediana dos itens comparáveis no raio de {x.radiusKm} km. Sem custo: subir item barato é seguro, baixar item caro não.
              </div>
            </div>
          </div>
          {r.withoutParity.length > 0 && (
            <p className="text-sm text-ink-muted" data-without-parity>
              {withoutParityLabel(r.withoutParity)}
            </p>
          )}
          {r.exclusives.length > 0 && (
            <p className="text-sm text-ink-muted" data-exclusives>
              {exclusiveLabel(r.exclusives)}
            </p>
          )}
          {history.runs.length > 1 && (
            <section className={`${card} overflow-x-auto p-4`} data-history>
              <h2 className="mb-1 font-bold">Histórico</h2>
              <p className="mb-3 text-xs text-ink-muted">Posição por preço: 1 é a loja mais barata entre as comparadas.</p>
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                    <th className={th}>Coleta</th>
                    {history.runs.map((r) => (
                      <th key={r.xrayId} className={`${th} text-right`}>
                        {runDateLabel(r.collectedAt)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr data-history-rank>
                    <td className={`${td} font-semibold`}>Posição por preço</td>
                    {history.runs.map((r) => (
                      <td key={r.xrayId} className={`${td} ${num}`}>
                        {r.rank ? `${r.rank.rank} de ${r.rank.of}` : ""}
                      </td>
                    ))}
                  </tr>
                  {history.items.map((i) => (
                    <tr key={i.id} data-history-item={i.name}>
                      <td className={td}>{i.name}</td>
                      {i.cells.map((c, k) => (
                        <td key={history.runs[k].xrayId} className={`${td} ${num} ${i.changed ? "text-ink" : "text-ink-muted"}`}>
                          {c === null ? "" : money(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </ConsoleMain>
  );
}
