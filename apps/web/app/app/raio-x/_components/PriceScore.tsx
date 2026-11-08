// M1-12 v3 "% de itens alinhados" (Marlon, 07/nov): the share of the compared items whose price sits in the
// neighborhood band (M1-07 na_media, up to 10% above or below the middle). Not a profit measure: no cost, no volume.
// Every place it shows on P19 to P24 renders one of these components, reading only loadResult().positions and
// loadHistory(). SHOW_SCORE false hides it everywhere, and the method paragraph goes with it.
import type { History, Result, Score } from "@/lib/monitor/load";
import { brl, scoreChangeSince, scoreDelta } from "@/lib/monitor/view";
import { HistoryChart } from "./Chart";

export const SHOW_SCORE = true;
export const SCORE_LABEL = "Itens alinhados";

/** The score row of a monitoring in P19: the newest run of loadHistory. */
export function scoreOfHistory(h: History | null): { score: number; delta: number | null } | null {
  const last = [...(h?.runs ?? [])].reverse().find((r) => r.score !== null);
  return last && last.score !== null ? { score: last.score, delta: last.delta } : null;
}

/** P19 row: "Itens alinhados 62% (+3)". */
export function ScoreInline({ score }: { score: { score: number; delta: number | null } | null }) {
  if (!SHOW_SCORE || !score) return null;
  const d = scoreDelta(score.delta);
  return (
    <>
      <br />
      {SCORE_LABEL} <b>{score.score}%</b> {d ? <span className="muted">({d})</span> : null}
    </>
  );
}

/** P23 card near the top (M1-12 v3 over the run's compared items). */
export function ScoreCard({ result, previousOn, competitor }: { result: Result; previousOn: string | null; competitor: boolean }) {
  const s = result.positions.score;
  if (!SHOW_SCORE || !s || s.score === null) return null;
  const change = scoreChangeSince(s.delta, previousOn);
  return (
    <section className="card scorec" aria-labelledby="sch">
      <div className="scn">
        <span className="eyebrow" id="sch">
          {SCORE_LABEL}
        </span>
        <span className="scv">
          <b className="mono">{s.score}%</b>
        </span>
        {change ? <span className="chg">{`${change}, mesmos ${s.delta_items ?? s.items} itens`}</span> : null}
      </div>
      <div className="scx">
        <p className="posline" style={{ fontSize: 15 }}>
          {s.in_band} de {s.items} itens comparados estão na faixa de preço da vizinhança, até 10% acima ou abaixo do meio.
        </p>
        <div className="meter" role="img" aria-label={`${s.score}% dos itens alinhados`}>
          <i style={{ width: `${s.score}%` }} />
        </div>
        <div className="scfacts">
          {s.below > 0 ? (
            <span className="up">
              {s.below} {s.below === 1 ? "item abaixo" : "itens abaixo"} do meio, <b className="mono">{brl(s.price_gap_per_sale_cents)}</b> de diferença por venda
            </span>
          ) : null}
          {s.risk > 0 ? (
            <span className="hold">
              {s.risk} {s.risk === 1 ? "item acima" : "itens acima"}
              {competitor ? " do meio" : ": não mexa sem saber o custo"}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** P23 category summary chip: "62% alinhados", or "poucos itens" under m1.score_min_items. */
export function CategoryScore({ score, minItems }: { score: Score | null | undefined; minItems: number }) {
  if (!SHOW_SCORE || !score) return null;
  return score.score === null ? (
    <span className="cscore" title={`Menos de ${minItems} itens comparados`}>
      poucos itens
    </span>
  ) : (
    <span className="cscore" title="Itens alinhados nesta categoria">
      <b>{score.score}%</b> alinhados
    </span>
  );
}

/** P23 method note paragraph. */
export function ScoreMethod({ competitor, minItems }: { competitor: boolean; minItems: number }) {
  if (!SHOW_SCORE) return null;
  return (
    <p>
      <b>Itens alinhados.</b> Contamos quantos itens comparados {competitor ? "ele vende" : "você vende"} na faixa de preço da vizinhança, até 10% acima ou abaixo do preço do meio. Itens abaixo e acima da faixa aparecem à parte. Não leva em conta custo nem volume de vendas. Categorias com menos de {minItems} itens comparados ficam sem número. A mudança desde o raio-X anterior compara os mesmos itens.
    </p>
  );
}

const scoreOpts = (label: string) => ({ lo: 0, hi: 100, ticks: [0, 50, 100], fmt: (v: number) => `${Math.round(v)}%`, label });

/** P24 restaurant level: the share line (scale 0 to 100%, runs before series_from or of an older formula carry nulls). */
export function ScoreHistory({ runs, labels, prevOn, id }: { runs: { score: number | null; delta: number | null }[]; labels: string[]; prevOn: string | null; id: string }) {
  if (!SHOW_SCORE) return null;
  const values = runs.map((r) => r.score);
  const last = runs.at(-1);
  if (!values.some((v) => v !== null)) return null;
  const change = scoreChangeSince(last?.delta ?? null, prevOn);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <h3>
        {SCORE_LABEL}{" "}
        <span className="small muted" style={{ fontWeight: 400 }}>
          {[last && last.score !== null ? `${last.score}%` : null, change].filter((x) => x !== null).join(" · ")}
        </span>
      </h3>
      <HistoryChart id={id} labels={labels} series={[{ name: "Itens alinhados", values, tone: "main" }]} {...scoreOpts(`${SCORE_LABEL} por raio-X`)} />
      <span className="xs muted">Parte dos itens comparados na faixa de preço da vizinhança, em cada raio-X. A mudança compara os mesmos itens do raio-X anterior.</span>
    </div>
  );
}

/** P24 category level: the category's score line, or "Poucos itens". */
export function CategoryScoreHistory({ label, values, delta, prevOn, minItems, id, labels }: { label: string; values: (number | null)[]; delta: number | null; prevOn: string | null; minItems: number; id: string; labels: string[] }) {
  if (!SHOW_SCORE) return null;
  if (!values.some((v) => v !== null))
    return (
      <div className="stack" style={{ gap: 6 }}>
        <h3>Itens alinhados em {label}</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Poucos itens: com menos de {minItems} itens comparados, a categoria fica sem número.
        </p>
      </div>
    );
  const last = [...values].reverse().find((v) => v !== null) ?? null;
  const change = scoreChangeSince(delta, prevOn);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <h3>
        Itens alinhados em {label}{" "}
        <span className="small muted" style={{ fontWeight: 400 }}>
          {[last !== null ? `${last}%` : null, change].filter((x) => x !== null).join(" · ")}
        </span>
      </h3>
      <HistoryChart id={id} labels={labels} series={[{ name: "Itens alinhados", values, tone: "main" }]} {...scoreOpts(`Itens alinhados em ${label} por raio-X`)} />
    </div>
  );
}
