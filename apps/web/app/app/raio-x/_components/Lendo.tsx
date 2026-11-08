"use client";
// P21 live part (draft §2.5): steps, counts over a segmented bar, the time range (lib/monitor/rules etaRange), "mais
// lenta", "enquanto isso" by category (partial, no prices) and "Por que demora?" (approved copy, real numbers). Polls the
// progress API every 15 s while the tab is visible and 60 s while hidden (Page Visibility); a finished capture or a
// calculated run refreshes the server part (which opens P22 or P23 when ready).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Partial, Progress } from "@/lib/monitor/load";
import type { Eta } from "@/lib/monitor/rules";
import { byGroup, hourMin, progressSegments, readSoFar, stepTexts } from "@/lib/monitor/view";
import { kmLabel } from "@/lib/xray/format";

export type LiveProgress = Progress & { eta: Eta; etaText: string | null; slow: boolean };

export const POLL_VISIBLE_MS = 15_000;
export const POLL_HIDDEN_MS = 60_000;

const SW: Record<string, string> = { done: "var(--color-ok)", running: "var(--color-ink-2)", retry_wait: "var(--color-warn)", queued: "var(--color-border-strong)", failed: "var(--color-danger)" };

export default function Lendo({ monitorId, own, storeName, radiusKm, initial, partial, lastResult }: { monitorId: string; own: boolean; storeName: string; radiusKm: number; initial: LiveProgress; partial: Partial | null; lastResult: { label: string } | null }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const seen = useRef({ done: initial.counts.done, step: initial.step });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/raio-x/${monitorId}/progress?raio-x=${initial.xray_id}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as LiveProgress;
          setP(next);
          if (next.counts.done !== seen.current.done || next.step !== seen.current.step) {
            seen.current = { done: next.counts.done, step: next.step };
            router.refresh();
          }
          if (next.step === "ready") return;
        }
      } catch {
        // Offline for a moment: try again on the next tick.
      }
      if (!stopped) schedule();
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(tick, document.visibilityState === "visible" ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
      else schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [monitorId, initial.xray_id, router]);

  const steps = stepTexts({ ...p, radiusKm });
  const target = p.stores.find((s) => s.is_target);
  const discover = p.step === "discover";
  const readMenus = p.stores.filter((s) => !s.is_target && s.state === "done").length;
  const banner = p.errors.extraction_off
    ? { cls: "badb", text: "A leitura automática está pausada. A equipe MargoAI já sabe e retoma assim que possível." }
    : p.errors.discover_failed
      ? { cls: "badb", text: "Não conseguimos buscar a vizinhança agora. Tentamos de novo sozinhos." }
      : p.errors.target_failed
        ? { cls: "badb", text: `Não conseguimos ler o cardápio ${own ? "da sua loja" : `de ${storeName}`} ainda.${p.target?.retry_at ? ` Tentamos de novo às ${hourMin(p.target.retry_at)}.` : ""} Se continuar, a equipe MargoAI olha para você.` }
        : p.slow
          ? { cls: "neutral", text: "A leitura está mais lenta agora. Continuamos sozinhos, não precisa fazer nada." }
          : p.step === "pair" || p.step === "calc"
            ? {
                cls: "okb",
                text: `Já dá para comparar com ${p.counts.done - (target?.state === "done" ? 1 : 0)} de ${p.stores_chosen} lojas.${p.counts.failed ? ` Não deu para ler ${p.counts.failed} ${p.counts.failed === 1 ? "loja" : "lojas"}; o raio-X segue sem elas.` : ""}${p.counts.running + p.counts.queued + p.counts.retry_wait ? " As que ainda estão sendo lidas entram no próximo raio-X." : ""}`,
              }
            : null;
  const cov = byGroup((partial?.own_items ?? []).filter((i) => i.stores > 0).sort((a, b) => b.stores - a.stores)).map((g) => ({ ...g, rows: g.rows.slice(0, 4) }));

  return (
    <>
      <section className="card" aria-label="Etapas">
        <div className="steps">
          {steps.map((s, i) => (
            <div key={s.title} className={`step ${s.state === "done" ? "done" : s.state === "now" ? "now" : ""}${i > steps.findIndex((x) => x.state === "now") + 1 ? " later" : ""}`} aria-current={s.state === "now" ? "step" : undefined}>
              <span className="n">
                {s.state === "done" ? "✓" : s.state === "now" ? <span className="dot" /> : i + 1} {s.state === "done" ? "feito" : s.state === "now" ? "agora" : "depois"}
              </span>
              <b>{s.title}</b>
              <span className="s">{s.sub}</span>
            </div>
          ))}
        </div>
      </section>
      {banner ? (
        <div className={`banner ${banner.cls}`} role="status">
          <span>{banner.text}</span>
        </div>
      ) : null}
      <div className="two">
        <div className="stack">
          <section className="card pad stack" aria-live="polite">
            {discover ? (
              <>
                <div className="small muted">Buscando a vizinhança</div>
                <div className="skel" />
                <div className="small">{p.etaText}</div>
              </>
            ) : (
              <>
                <div className="row-flex between" style={{ alignItems: "flex-end" }}>
                  <div>
                    <div className="big" data-testid="lidos">
                      {p.counts.done}{" "}
                      <span className="muted" style={{ fontSize: 20 }}>
                        de {p.counts.total}
                      </span>
                    </div>
                    <div className="small muted">cardápios lidos, contando o {own ? "seu" : "dela"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600 }} data-testid="eta">
                      {p.etaText}
                    </div>
                    {p.errors.extraction_off || p.errors.target_failed ? null : <div className="xs muted">estimativa pelo ritmo dos últimos {p.pace.window_minutes} minutos</div>}
                  </div>
                </div>
                <div className="seg" role="img" aria-label={`${p.counts.done} lidos, ${p.counts.running} lendo agora, ${p.counts.queued} na fila, ${p.counts.retry_wait} tentando de novo, ${p.counts.failed} não deu para ler`}>
                  {progressSegments(p.counts).map((s) => (s.pct > 0 ? <i key={s.state} className={`s-${s.state}`} style={{ width: `${s.pct}%` }} /> : null))}
                </div>
                <div className="legend-row">
                  <span>
                    <i className="sw" style={{ background: SW.done }} />
                    lidos {p.counts.done}
                  </span>
                  <span>
                    <i className="sw" style={{ background: SW.running }} />
                    lendo agora {p.counts.running}
                  </span>
                  {p.counts.retry_wait ? (
                    <span>
                      <i className="sw" style={{ background: SW.retry_wait }} />
                      tentando de novo {p.counts.retry_wait}
                      {p.pace.latest_retry_at ? `, às ${hourMin(p.pace.latest_retry_at)}` : ""}
                    </span>
                  ) : null}
                  <span>
                    <i className="sw" style={{ background: SW.queued }} />
                    na fila {p.counts.queued}
                  </span>
                  {p.counts.failed ? (
                    <span>
                      <i className="sw" style={{ background: SW.failed }} />
                      não deu para ler {p.counts.failed}
                    </span>
                  ) : null}
                  {p.counts.beyond_cap ? (
                    <span>
                      fora das {p.stores_chosen} mais relevantes: {p.counts.beyond_cap}
                    </span>
                  ) : null}
                </div>
                <div className="small">
                  {target?.state === "done" ? (
                    <span className="pill p-ok">{own ? "sua loja" : storeName}: lida{target.items !== null ? `, ${target.items} itens` : ""}</span>
                  ) : (
                    <span className="pill p-warn">{own ? "sua loja" : storeName}: ainda não lida</span>
                  )}
                </div>
              </>
            )}
            <div className="why">
              Estamos lendo o cardápio completo de cada uma das {p.stores_chosen || "30"} lojas perto de {own ? "você" : "dela"}, uma por uma.
              {readMenus ? ` ${readSoFar(readMenus, p.items_read)}` : ""}
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontWeight: 500 }}>Por que demora?</summary>
                <ul>
                  <li>Comparamos cada item seu com os delas: mesmo produto, mesmo tamanho, mesmo sabor.</li>
                  <li>O resultado só conta lojas que vendem o mesmo item de verdade.</li>
                  <li>Você recebe uma análise feita para a sua loja, não uma média genérica.</li>
                </ul>
              </details>
            </div>
          </section>
          <section className="card pad row-flex between">
            <div>
              <b>Pode fechar esta página.</b>
              <div className="small muted">Avisamos por e-mail e WhatsApp quando estiver pronto. Entre 22h e 8h, o WhatsApp espera até as 8h.</div>
            </div>
            {lastResult ? (
              <Link className="btn sm" href={`/app/raio-x/${monitorId}`}>
                Ver o último resultado ({lastResult.label})
              </Link>
            ) : null}
          </section>
        </div>
        {discover || !partial ? (
          <div className="card pad stack">
            <h3>Enquanto isso</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Assim que a vizinhança aparecer, mostramos aqui as lojas encontradas.
            </p>
            <div className="skel" style={{ width: "80%" }} />
            <div className="skel" style={{ width: "60%" }} />
          </div>
        ) : (
          <div className="card pad stack">
            <div className="row-flex between">
              <h3>Enquanto isso</h3>
              <span className="partial">parcial, ainda sem comparação</span>
            </div>
            {cov.length ? (
              <>
                <div className="small muted">Seus itens que já aparecem nas lojas lidas, pelo nome igual:</div>
                <div className="cov">
                  {cov.map((g) => (
                    <div key={g.group} style={{ display: "contents" }}>
                      <span className="covh">{g.label}</span>
                      {g.rows.map((r) => (
                        <div key={r.own_item_id}>
                          <span>{r.name}</span>
                          <span className="bar">
                            <i style={{ width: `${Math.min(100, Math.round((r.stores / Math.max(1, partial.stores_read.length)) * 100))}%` }} />
                          </span>
                          <span className="mono small">{r.stores}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            <p className="xs muted" style={{ margin: 0 }}>
              Ainda não comparamos tamanho e sabor nem calculamos preços. O resultado pode mudar.
            </p>
            <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 10 }} className="small">
              <b>Cardápios já lidos</b>
            </div>
            <div className="slist">
              {partial.stores_read.slice(0, 6).map((s) => (
                <div key={s.public_store_id}>
                  <span>{s.name ?? "Loja"}</span>
                  <span className="small muted">{s.distance_m !== null ? kmLabel(s.distance_m) : ""}</span>
                  <span className="small mono">{s.items} itens</span>
                </div>
              ))}
              {partial.stores_read.length > 6 ? (
                <div>
                  <span className="small muted">e mais {partial.stores_read.length - 6} lojas</span>
                  <span />
                  <span />
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
