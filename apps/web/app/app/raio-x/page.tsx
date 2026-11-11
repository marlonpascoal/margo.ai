// P19 (phone) / W10 (computer): "Raio-X de preço", the stores this person follows (draft §2.3). Rows come through the
// person's RLS read (A03: a Gerente sees the monitorings of their kitchens only). Position is M1-10 (rank, 1 = cheapest),
// the score M1-12 (PriceScore.tsx, provisional). Actions and the plan line are the Dono's (manage_monitors).
import Link from "next/link";
import { loadDeps } from "@/lib/monitor/deps";
import { loadHistory, loadMonitorList, type MonitorSummary } from "@/lib/monitor/load";
import { canManageMonitors } from "@/lib/monitor/rules";
import { monitorPill, ordinal, periodLabel, positionLabel, planLine, rankDelta, weekdayDayMon } from "@/lib/monitor/view";
import { requirePortal } from "@/lib/portal/session";
import MonitorMenu from "./_components/MonitorMenu";
import { ScoreInline, scoreOfHistory } from "./_components/PriceScore";
import { Fict, Head, Pill } from "./_components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Raio-X de preço · MargoAI" };

export default async function MonitorListPage() {
  const m = await requirePortal({ action: "see_xray", flags: ["m1.portal"] });
  const deps = loadDeps(m.db);
  const [{ monitors, limits }, { data: kitchens }] = await Promise.all([loadMonitorList(deps, m.account.id), m.db.from("kitchen").select("id, name").eq("account_id", m.account.id)]);
  const scores = new Map(await Promise.all(monitors.map(async (r) => [r.monitor_id, scoreOfHistory(r.last_ready ? await loadHistory(deps, r.monitor_id) : null)] as const)));
  const kitchenName = (id: string | null) => (kitchens ?? []).find((k) => k.id === id)?.name.replace(/^Cozinha\s+/i, "") ?? null;
  const manage = canManageMonitors(m.role);
  const synthetic = m.account.isSynthetic;
  const own = monitors.filter((r) => r.target_kind === "own");
  const comps = monitors.filter((r) => r.target_kind === "competitor");
  const compFull = limits.competitor_allowed && limits.competitor_active >= limits.competitor_max;

  const row = (r: MonitorSummary) => {
    const pill = monitorPill(r);
    const reading = pill.kind === "reading" || pill.kind === "waiting";
    const lr = r.last_ready;
    const paused = r.status !== "active";
    const where = r.target_kind === "competitor" ? [r.store_area, kitchenName(r.kitchen_id) ? `perto de ${kitchenName(r.kitchen_id)}` : null].filter(Boolean).join(" · ") : (r.store_area ?? "iFood");
    const q = r.latest?.quorum;
    return (
      <div className="mon" key={r.monitor_id} data-monitor={r.monitor_id}>
        <div className="nm">
          <b>{r.store_name ?? "Loja"}</b>
          <span>{where}</span>
        </div>
        <div className="st">
          <Pill kind={pill.kind} text={pill.text} href={pill.to ? `/app/raio-x/${r.monitor_id}/${pill.to}` : null} />
        </div>
        <div className="when">
          {paused ? (
            <>
              {lr ? (
                <>
                  Última leitura <b>{weekdayDayMon(lr.on)}</b>
                  <br />
                </>
              ) : null}
              {r.status === "paused_by_plan" ? "Volta quando você assinar o Lucro." : "Pausado. Retome quando quiser."}
            </>
          ) : reading ? (
            <>
              Lendo agora
              {q && q.total ? (
                <div className="prog" aria-hidden="true">
                  <i style={{ width: `${Math.round((q.finished / Math.max(q.total, 1)) * 100)}%` }} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              {lr ? (
                <>
                  Última leitura <b>{weekdayDayMon(lr.on)}</b>
                  <br />
                </>
              ) : null}
              {r.next_run_at ? (
                <>
                  Próxima <b>{weekdayDayMon(r.next_run_at)}</b> ·{" "}
                </>
              ) : null}
              {periodLabel(r.effective_every_days)}
            </>
          )}
        </div>
        <div className="pos">
          {lr?.rank && lr.stores_ranked ? (
            <>
              <b>{positionLabel(lr.rank, lr.stores_ranked)}</b>
              {rankDelta(lr.rank, lr.previous_rank) ? <span className="muted"> ({rankDelta(lr.rank, lr.previous_rank)})</span> : null}
              <ScoreInline score={scores.get(r.monitor_id) ?? null} />
            </>
          ) : null}
        </div>
        <div className="acts">
          {lr && !reading ? (
            <Link className="btn sm" href={`/app/raio-x/${r.monitor_id}`}>
              Ver resultado
            </Link>
          ) : (
            <Link className="btn sm" href={`/app/raio-x/${r.monitor_id}/lendo`}>
              Acompanhar
            </Link>
          )}
          {lr ? (
            <Link className="linkbtn small" href={`/app/raio-x/${r.monitor_id}/historico`}>
              Histórico
            </Link>
          ) : null}
          {manage ? <MonitorMenu monitorId={r.monitor_id} name={r.store_name ?? "Loja"} status={r.status} everyDays={r.every_days} minEveryDays={limits.min_every_days} /> : null}
        </div>
      </div>
    );
  };

  return (
    <main className="rx-main">
      <Head title="Raio-X de preço" lead="As lojas que você acompanha. Toda semana lemos os cardápios em volta de cada uma e comparamos os preços.">
        <Fict synthetic={synthetic} />
        {manage ? (
          <Link className="btn primary" href="/app/raio-x/novo">
            Acompanhar uma loja
          </Link>
        ) : null}
      </Head>
      {monitors.length === 0 ? (
        <div className="card pad stack" style={{ justifyItems: "start", padding: 28 }}>
          <h2>Você ainda não acompanha nenhuma loja.</h2>
          <p className="muted" style={{ margin: 0, maxWidth: "60ch" }}>
            Toda semana lemos os cardápios das lojas perto de você e mostramos onde o seu preço está abaixo ou acima da vizinhança. Só usamos o que está público no iFood.
          </p>
          {manage ? (
            <Link className="btn primary" href="/app/raio-x/novo">
              Acompanhar minha loja
            </Link>
          ) : (
            <span className="small muted">Peça ao Dono para começar.</span>
          )}
        </div>
      ) : (
        <>
          {manage ? (
            <div className="planline">
              {planLine(limits).map((p) => (
                <span key={p.label}>
                  {p.label} <b>{p.value}</b>
                </span>
              ))}
            </div>
          ) : null}
          {own.length ? (
            <section className="card" aria-label="Suas lojas">
              <div className="ghead">
                <h2>Suas lojas</h2>
                <span className="small muted">posicionamento: entrada, intermediário ou premium na região</span>
              </div>
              {own.map(row)}
            </section>
          ) : null}
          {comps.length ? (
            <section className="card" aria-label="Concorrentes">
              <div className="ghead">
                <h2>Concorrentes</h2>
                <span className="small muted">
                  {manage && compFull
                    ? `${limits.competitor_active} de ${limits.competitor_max} ativos. Para outro, pause ou remova um.`
                    : "o raio-X mostra como cada um se posiciona na vizinhança dele"}
                </span>
              </div>
              {comps.map(row)}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
