// M1-12 "score de preço" (proposed in spec/04, PROVISIONAL). Marlon has not picked between "% de itens alinhados" and
// no score at all: every place a score shows on P19 to P24 renders one of these components, reading only
// loadResult().positions and loadHistory(). To change or drop the score, change this file: SHOW_SCORE false hides it
// everywhere, and the method paragraph goes with it.
import type { History, Result, Score } from "@/lib/monitor/load";
import { brl, scoreChangeSince, scoreDelta } from "@/lib/monitor/view";
import { HistoryChart } from "./Chart";

export const SHOW_SCORE = true;
export const SCORE_LABEL = "Score de preço";

/** The score row of a monitoring in P19: the newest run of loadHistory. */
export function scoreOfHistory(h: History | null): { score: number; delta: number | null } | null {
  const last = [...(h?.runs ?? [])].reverse().find((r) => r.score !== null);
  return last && last.score !== null ? { score: last.score, delta: last.delta } : null;
}

/** P19 row: "Score de preço 98 (+1)". */
export function ScoreInline({ score }: { score: { score: number; delta: number | null } | null }) {
  if (!SHOW_SCORE || !score) return null;
  const d = scoreDelta(score.delta);
  return (
    <>
      <br />
      {SCORE_LABEL} <b>{score.score}</b> {d ? <span className="muted">({d})</span> : null}
    </>
  );
}

/** P23 card near the top (M1-12 over the run's compared items). */
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
          <b className="mono">{s.score}</b>
          <span className="muted">/100</span>
        </span>
        {change ? <span className="chg">{`${change}, mesmos ${s.delta_items ?? s.items} itens`}</span> : null}
      </div>
      <div className="scx">
        <p className="posline" style={{ fontSize: 15 }}>
          Quanto do preço praticado pela vizinhança {competitor ? "ele cobra" : "você cobra"}. Itens abaixo do meio baixam o score; itens acima não entram nele e aparecem à parte.
        </p>
        <div className="meter" role="img" aria-label={`Score ${s.score} de 100`}>
          <i style={{ width: `${s.score}%` }} />
        </div>
        <div className="scfacts">
          {s.below > 0 ? (
            <span className="up">
              <b className="mono">{brl(s.price_gap_per_sale_cents)}</b> de diferença por venda para o meio, em {s.below} {s.below === 1 ? "item abaixo" : "itens abaixo"}
            </span>
          ) : null}
          {s.risk > 0 ? (
            <span className="hold">
              {s.risk} {s.risk === 1 ? "item acima" : "itens acima"}
              {competitor ? " do meio" : ": não mexa sem saber o custo"}
            </span>
          ) : null}
          <span className="muted">{s.in_band} itens na faixa</span>
        </div>
      </div>
    </section>
  );
}

/** P23 category summary chip: "score 96", or "poucos itens" under m1.score_min_items. */
export function CategoryScore({ score, minItems }: { score: Score | null | undefined; minItems: number }) {
  if (!SHOW_SCORE || !score) return null;
  return score.score === null ? (
    <span className="cscore" title={`Menos de ${minItems} itens comparados`}>
      poucos itens
    </span>
  ) : (
    <span className="cscore" title="Score de preço nesta categoria">
      score <b>{score.score}</b>
    </span>
  );
}

/** P23 method note paragraph. */
export function ScoreMethod({ competitor, minItems }: { competitor: boolean; minItems: number }) {
  if (!SHOW_SCORE) return null;
  return (
    <p>
      <b>Score de preço.</b> Somamos o preço do meio de cada item comparado. Itens abaixo do meio entram pelo preço {competitor ? "dele" : "seu"}; os outros, pelo preço do meio. O score é quanto dessa soma{" "}
      {competitor ? "ele cobra" : "você cobra"}. Itens acima do meio não mudam o score: aparecem à parte. Categorias com menos de {minItems} itens comparados ficam sem score. A mudança desde o raio-X anterior compara os mesmos itens.
    </p>
  );
}

const scoreOpts = (label: string) => ({ lo: 80, hi: 100, ticks: [80, 90, 100], fmt: (v: number) => String(Math.round(v)), label });

/** P24 restaurant level: the score line (scale 80 to 100, runs before series_from carry nulls). */
export function ScoreHistory({ runs, labels, prevOn, id }: { runs: { score: number | null; delta: number | null }[]; labels: string[]; prevOn: string | null; id: string }) {
  if (!SHOW_SCORE) return null;
  const values = runs.map((r) => r.score);
  const last = runs.at(-1);
  if (!values.some((v) => v !== null)) return null;
  const change = scoreChangeSince(last?.delta ?? null, prevOn);
  const lo = Math.min(80, ...values.filter((v): v is number => v !== null).map((v) => Math.floor(v / 10) * 10));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <h3>
        {SCORE_LABEL}{" "}
        <span className="small muted" style={{ fontWeight: 400 }}>
          {[last?.score ?? null, change].filter((x) => x !== null).join(" · ")}
        </span>
      </h3>
      <HistoryChart id={id} labels={labels} series={[{ name: "Score", values, tone: "main" }]} {...scoreOpts(`${SCORE_LABEL} por raio-X`)} lo={lo} ticks={[lo, (lo + 100) / 2, 100]} />
      <span className="xs muted">Escala de {lo} a 100. 100: nenhum item abaixo do preço do meio da vizinhança. Cada ponto compara os mesmos itens do raio-X anterior.</span>
    </div>
  );
}

/** P24 category level: the category's score line, or "Poucos itens". */
export function CategoryScoreHistory({ label, values, delta, prevOn, minItems, id, labels }: { label: string; values: (number | null)[]; delta: number | null; prevOn: string | null; minItems: number; id: string; labels: string[] }) {
  if (!SHOW_SCORE) return null;
  if (!values.some((v) => v !== null))
    return (
      <div className="stack" style={{ gap: 6 }}>
        <h3>Score em {label}</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Poucos itens: com menos de {minItems} itens comparados, a categoria fica sem score.
        </p>
      </div>
    );
  const last = [...values].reverse().find((v) => v !== null) ?? null;
  const change = scoreChangeSince(delta, prevOn);
  const lo = Math.min(80, ...values.filter((v): v is number => v !== null).map((v) => Math.floor(v / 10) * 10));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <h3>
        Score em {label}{" "}
        <span className="small muted" style={{ fontWeight: 400 }}>
          {[last, change].filter((x) => x !== null).join(" · ")}
        </span>
      </h3>
      <HistoryChart id={id} labels={labels} series={[{ name: "Score", values, tone: "main" }]} {...scoreOpts(`Score de ${label} por raio-X`)} lo={lo} ticks={[lo, (lo + 100) / 2, 100]} />
    </div>
  );
}
