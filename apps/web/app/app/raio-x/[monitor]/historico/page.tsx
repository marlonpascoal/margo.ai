// P24 (phone) / W15 (computer): "Histórico" (draft §2.8), three levels: the restaurant (M1-12 score and M1-10 position per
// run), a category (picker; its score and position among the stores selling it) and a product (own price and the
// neighborhood middle, M1-05, and its position among the stores selling it). Each chart has "Ver como tabela". Runs are
// never rewritten; a paused week is simply absent and a run without a number breaks the line.
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import NavSelect from "@/components/NavSelect";
import { loadDeps } from "@/lib/monitor/deps";
import { loadHistory, loadItemHistory, loadMonitorSummary, scoreMinItems } from "@/lib/monitor/load";
import { GROUP_LABEL, type Group } from "@/lib/monitor/rules";
import { brl, dayMon, ordinal, rankChangeSince } from "@/lib/monitor/view";
import { requirePortal } from "@/lib/portal/session";
import { HistoryChart } from "../../_components/Chart";
import { CategoryScoreHistory, SCORE_LABEL, SHOW_SCORE, ScoreHistory } from "../../_components/PriceScore";
import TableToggle from "../../_components/TableToggle";
import { Crumb, Fict, Head } from "../../_components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Histórico do raio-X · MargoAI" };

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="scrollx">
      <table className="tbl">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={i ? "r" : ""}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k}>
              {r.map((v, i) => (
                <td key={i} className={i ? "r" : ""}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const posOpts = (of: number, label: string) => {
  const hi = Math.max(of, 4);
  return { lo: 1, hi, invert: true, ticks: [1, Math.round(hi / 2), hi], fmt: (v: number) => ordinal(Math.round(v)), label };
};

export default async function HistoryPage({ params, searchParams }: { params: Promise<{ monitor: string }>; searchParams: Promise<{ categoria?: string; item?: string }> }) {
  const { monitor } = await params;
  const q = await searchParams;
  const m = await requirePortal({ action: "see_xray", flags: ["m1.portal"] });
  const deps = loadDeps(m.db);
  const [summary, history, minItems] = await Promise.all([loadMonitorSummary(deps, monitor), loadHistory(deps, monitor), scoreMinItems(m.db)]);
  if (!summary || !history) notFound();
  const name = summary.store_name ?? "Loja";
  const runs = history.runs.filter((r) => ["ready", "delivered"].includes(r.status) && r.on);
  const base = `/app/raio-x/${monitor}/historico`;
  const head = (
    <>
      <Crumb>{name}</Crumb>
      <Head title="Histórico" lead={runs.length ? `${name} · ${runs.length} raio-X desde ${dayMon(runs[0].on!)}.` : name}>
        <Fict synthetic={m.account.isSynthetic} />
      </Head>
    </>
  );
  if (runs.length < 2)
    return (
      <main className="rx-main">
        {head}
        <div className="card pad stack" style={{ justifyItems: "start" }}>
          <b>O histórico aparece a partir do segundo raio-X{summary.next_run_at ? `, em ${dayMon(summary.next_run_at)}` : ""}.</b>
          <span className="small muted">A cada raio-X somamos um ponto: score de preço, posição de preço, cada categoria e o preço de cada item.</span>
          {runs.length ? (
            <Link className="btn sm" href={`/app/raio-x/${monitor}`}>
              Ver o raio-X de {dayMon(runs[0].on!)}
            </Link>
          ) : null}
        </div>
      </main>
    );

  const labels = runs.map((r) => dayMon(r.on!));
  const prevOn = runs.at(-2)!.on;
  const last = runs.at(-1)!;
  const maxOf = Math.max(...runs.map((r) => r.stores_ranked ?? 0), 4);

  // Category level: the groups of the newest run, the chosen one or the first.
  const groups = (last.by_category ?? []).map((c) => c.group).filter((g) => g !== "so_seus");
  const cat = ((groups as string[]).includes(q.categoria ?? "") ? q.categoria : groups[0]) as Group | undefined;
  const catRuns = runs.map((r) => r.by_category.find((c) => c.group === cat) ?? null);
  const catLabel = cat ? (GROUP_LABEL[cat] ?? cat) : "";
  const catOf = Math.max(...catRuns.map((c) => c?.stores_ranked ?? 0), 4);
  const catLast = catRuns.at(-1);

  // Product level: the chosen item of the picker, or the first.
  const item = history.picker.find((p) => p.own_item_id === q.item) ?? history.picker[0];
  const points = item ? ((await loadItemHistory(deps, monitor, item.own_item_id)) ?? []) : [];
  const byRun = new Map(points.map((p) => [p.xray_id, p]));
  const ip = runs.map((r) => byRun.get(r.xray_id) ?? null);
  const own = ip.map((p) => p?.own_cents ?? null);
  const mid = ip.map((p) => p?.parity_cents ?? null);
  const iRank = ip.map((p) => p?.rank ?? null);
  const iOf = Math.max(...ip.map((p) => p?.stores ?? 0), 4);
  const prices = [...own, ...mid].filter((v): v is number => v !== null);
  const pLo = prices.length ? Math.floor((Math.min(...prices) * 0.9) / 100) * 100 : 0;
  const pHi = prices.length ? Math.ceil((Math.max(...prices) * 1.1) / 100) * 100 : 100;
  const lastIp = ip.at(-1);

  return (
    <main className="rx-main">
      {head}
      <TableToggle
        id="hr"
        title="O restaurante"
        sub={`${SHOW_SCORE ? "Score de preço e posição" : "Posição"} de preço, a cada raio-X`}
        chart={
          <div className="h3row">
            {SHOW_SCORE ? <ScoreHistory id="cScore" runs={runs.map((r) => ({ score: r.score, delta: r.delta }))} labels={labels} prevOn={prevOn} /> : null}
            <div className="stack" style={{ gap: 6 }}>
              <h3>
                Posição de preço{" "}
                <span className="small muted" style={{ fontWeight: 400 }}>
                  {[last.rank && last.stores_ranked ? `${ordinal(last.rank)} de ${last.stores_ranked}` : null, rankChangeSince(last.rank, runs.at(-2)!.rank, prevOn)].filter(Boolean).join(" · ")}
                </span>
              </h3>
              <HistoryChart id="cPos" labels={labels} series={[{ name: "Posição", values: runs.map((r) => r.rank), tone: "main" }]} {...posOpts(maxOf, "Posição de preço por raio-X")} />
              <span className="xs muted">1ª = a loja mais barata da vizinhança.</span>
            </div>
          </div>
        }
        table={<Table head={["Raio-X", ...(SHOW_SCORE ? [SCORE_LABEL] : []), "Posição", "Lojas"]} rows={runs.map((r, i) => [labels[i], ...(SHOW_SCORE ? [r.score ?? "sem score"] : []), r.rank ? ordinal(r.rank) : "", r.stores_ranked ?? ""])} />}
      />

      {cat ? (
        <TableToggle
          id="hc"
          title="Por categoria"
          sub="Score e posição de cada categoria, entre as lojas que vendem itens dela"
          chart={
            <div className="stack">
              <div className="chips" role="group" aria-label="Escolher categoria">
                {groups.map((g) => {
                  const s = last.by_category.find((c) => c.group === g)?.score;
                  return (
                    <Link key={g} className="chip" aria-current={g === cat ? "true" : undefined} href={`${base}?categoria=${g}${item ? `&item=${item.own_item_id}` : ""}`} scroll={false}>
                      {GROUP_LABEL[g] ?? g}
                      {SHOW_SCORE ? <span className="mono">{s ?? "poucos itens"}</span> : null}
                    </Link>
                  );
                })}
              </div>
              <div className="h3row">
                <CategoryScoreHistory id="cCatScore" label={catLabel} values={catRuns.map((c) => c?.score ?? null)} delta={catLast?.delta ?? null} prevOn={prevOn} minItems={minItems} labels={labels} />
                <div className="stack" style={{ gap: 6 }}>
                  <h3>
                    Posição em {catLabel}{" "}
                    <span className="small muted" style={{ fontWeight: 400 }}>
                      {[catLast?.rank && catLast.stores_ranked ? `${ordinal(catLast.rank)} de ${catLast.stores_ranked}` : null, rankChangeSince(catLast?.rank ?? null, catRuns.at(-2)?.rank ?? null, prevOn)].filter(Boolean).join(" · ")}
                    </span>
                  </h3>
                  <HistoryChart id="cCatPos" labels={labels} series={[{ name: "Posição", values: catRuns.map((c) => c?.rank ?? null), tone: "main" }]} {...posOpts(catOf, `Posição de ${catLabel} por raio-X`)} />
                </div>
              </div>
            </div>
          }
          table={
            <Table
              head={["Raio-X", ...(SHOW_SCORE ? [`Score ${catLabel}`] : []), `Posição ${catLabel}`]}
              rows={runs.map((_, i) => [labels[i], ...(SHOW_SCORE ? [catRuns[i]?.score ?? "poucos itens"] : []), catRuns[i]?.rank ? `${ordinal(catRuns[i]!.rank!)} de ${catRuns[i]!.stores_ranked}` : ""])}
            />
          }
        />
      ) : null}

      {item ? (
        <TableToggle
          id="hp"
          title="Um produto"
          sub="Preço e posição entre as lojas que vendem o item"
          extra={
            <NavSelect
              label="Item"
              value={item.own_item_id}
              options={history.picker.map((p) => ({ value: p.own_item_id, label: `${GROUP_LABEL[p.group] ?? p.group} · ${p.name}`, href: `${base}?item=${p.own_item_id}${cat ? `&categoria=${cat}` : ""}` }))}
            />
          }
          chart={
            <div className="h3row">
              <div className="stack" style={{ gap: 6 }}>
                <h3>Preço de {item.name}</h3>
                <div className="keyrow">
                  <span>
                    <i className="kline" style={{ borderColor: "var(--color-ink-2)" }} />
                    Você
                  </span>
                  <span>
                    <i className="kline" style={{ borderColor: "var(--color-ink-muted)", borderTopStyle: "dashed" }} />
                    Meio da vizinhança
                  </span>
                </div>
                <HistoryChart
                  id="cPrice"
                  labels={labels}
                  series={[
                    { name: "Você", values: own, tone: "main" },
                    { name: "Meio da vizinhança", values: mid, tone: "middle" },
                  ]}
                  lo={pLo}
                  hi={pHi}
                  ticks={[pLo, Math.round((pLo + pHi) / 200) * 100, pHi]}
                  fmt={(v) => brl(Math.round(v / 10) * 10).replace(",00", "")}
                  short={(s) => (s.tone === "main" ? "Você" : "Meio")}
                  label={`Preço de ${item.name} por raio-X`}
                />
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <h3>
                  Posição do seu preço{" "}
                  <span className="small muted" style={{ fontWeight: 400 }}>
                    {[lastIp?.rank && lastIp.stores ? `${ordinal(lastIp.rank)} mais barata de ${lastIp.stores}` : null, rankChangeSince(lastIp?.rank ?? null, ip.at(-2)?.rank ?? null, prevOn)].filter(Boolean).join(" · ")}
                  </span>
                </h3>
                <HistoryChart id="cItemPos" labels={labels} series={[{ name: "Posição", values: iRank, tone: "main" }]} {...posOpts(iOf, `Posição de ${item.name} por raio-X`)} />
                <span className="xs muted">1ª = o preço mais barato entre as lojas que vendem o item.</span>
              </div>
            </div>
          }
          table={<Table head={["Raio-X", "Você", "Meio", "Posição"]} rows={runs.map((_, i) => [labels[i], own[i] !== null ? brl(own[i]!) : "", mid[i] !== null ? brl(mid[i]!) : "", ip[i]?.rank ? `${ordinal(ip[i]!.rank!)} de ${ip[i]!.stores}` : ""])} />}
        />
      ) : null}

      <section className="card" style={{ minWidth: 0 }}>
        <div className="ghead">
          <h2>Raio-X anteriores</h2>
        </div>
        <Table
          head={["Data", "Lojas lidas", ...(SHOW_SCORE ? ["Score"] : []), "Posição", "Itens comparados", ""]}
          rows={[...runs].reverse().map((r, i) => [
            dayMon(r.on!),
            r.stores_read,
            ...(SHOW_SCORE ? [r.score ?? ""] : []),
            r.rank && r.stores_ranked ? `${ordinal(r.rank)} de ${r.stores_ranked}` : "",
            r.items_compared,
            <Link key="v" className="small" href={i === 0 ? `/app/raio-x/${monitor}` : `/app/raio-x/${monitor}/${r.xray_id}`}>
              Ver
            </Link>,
          ])}
        />
      </section>
    </main>
  );
}
