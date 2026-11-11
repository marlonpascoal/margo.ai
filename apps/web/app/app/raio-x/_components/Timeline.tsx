// P23 timeline (Marlon, 08/nov: a single X-ray is one point of the monitoring's chart). "Raio-X n desta loja", the next
// run, and a small chart of the last up to 8 calculated runs: M1-12 v3 "Itens alinhados" and the M1-10 position
// (entrada embaixo, premium em cima), this run's point highlighted and the next run as an empty dotted point. Server-rendered SVG on
// linePaths, as HistoryChart (Chart.tsx), which has neither a highlighted point nor a pending one, so it is not reused.
import Link from "next/link";
import type { History, MonitorStatus } from "@/lib/monitor/load";
import { linePaths, nextRunText, positionLabel, runLabel, tierWord, timelineWindow, type TimelinePoint } from "@/lib/monitor/view";
import { SCORE_LABEL, SHOW_SCORE } from "./PriceScore";

export interface TimelineProps {
  monitorId: string;
  /** The run shown on P23. */
  xrayId: string;
  /** loadHistory(...).runs, every run of the monitoring oldest first. */
  runs: History["runs"];
  /** MonitorSummary.next_run_at. */
  nextRunAt: string | null;
  /** MonitorSummary.status. */
  status: MonitorStatus;
  mode: "screen" | "print";
}

const W = 640;
const LEFT = 118;
const RIGHT = 56;

interface Panel {
  key: string;
  title: string;
  top: number;
  bottom: number;
  lo: number;
  hi: number;
  invert?: boolean;
  values: (number | null)[];
  fmt: (v: number, p: TimelinePoint) => string;
}

function PanelSvg({ panel, points, hasNext, height }: { panel: Panel; points: TimelinePoint[]; hasNext: boolean; height: number }) {
  const values = hasNext ? [...panel.values, null] : panel.values;
  const g = linePaths(values, { width: W, height, left: LEFT, right: RIGHT, top: panel.top, bottom: height - panel.bottom, lo: panel.lo, hi: panel.hi, invert: panel.invert });
  const lastIdx = panel.values.reduce<number>((a, v, i) => (v === null ? a : i), -1);
  const cur = points.findIndex((p) => p.current);
  const curV = cur >= 0 ? panel.values[cur] : null;
  return (
    <g>
      <text className="ttl" x={0} y={(panel.top + panel.bottom) / 2 - 4}>
        {panel.title}
      </text>
      {curV !== null && cur >= 0 ? (
        <text className="tv" x={0} y={(panel.top + panel.bottom) / 2 + 13}>
          {panel.fmt(curV, points[cur])}
        </text>
      ) : null}
      <line className="grid" x1={LEFT} x2={W - RIGHT} y1={panel.bottom} y2={panel.bottom} />
      {g.segments.map((pts, j) => (pts.includes(" ") ? <polyline key={j} className="ln" points={pts} /> : null))}
      {hasNext && lastIdx >= 0 ? <line className="nx" x1={g.x(lastIdx)} y1={g.y(panel.values[lastIdx] as number)} x2={g.x(values.length - 1)} y2={g.y(panel.values[lastIdx] as number)} /> : null}
      {hasNext && lastIdx >= 0 ? <circle className="pt next" cx={g.x(values.length - 1)} cy={g.y(panel.values[lastIdx] as number)} r={4.5} /> : null}
      {panel.values.map((v, i) =>
        v === null ? null : (
          <circle key={i} className={`pt${points[i].current ? " cur" : ""}`} cx={g.x(i)} cy={g.y(v)} r={points[i].current ? 6 : 3.5}>
            <title>{`${points[i].label}: ${panel.title} ${panel.fmt(v, points[i])}`}</title>
          </circle>
        ),
      )}
    </g>
  );
}

export default function Timeline(p: TimelineProps) {
  const w = timelineWindow(p.runs, p.xrayId, { nextRunAt: p.nextRunAt, status: p.status });
  if (!w.points.length) return null;
  const label = runLabel(p.runs, p.xrayId);
  const next = nextRunText(p.nextRunAt, p.status);
  const hasNext = w.next !== null;
  const maxOf = Math.max(4, ...w.points.map((x) => x.stores_ranked ?? 0));
  const panels: Panel[] = [];
  // M1-12 v3: share of the compared items in the neighborhood band, 0 to 100.
  if (SHOW_SCORE)
    panels.push({ key: "score", title: SCORE_LABEL, top: 10, bottom: 52, lo: 0, hi: 100, values: w.points.map((x) => x.score), fmt: (v) => `${v}%` });
  // M1-10: position among the neighborhood stores, premium (the last rank) drawn on top.
  const top = panels.length ? 76 : 10;
  panels.push({
    key: "rank",
    title: "Posicionamento",
    top,
    bottom: top + 42,
    lo: 1,
    hi: maxOf,
    invert: false,
    values: w.points.map((x) => x.rank),
    fmt: (v, pt) => (pt.stores_ranked ? tierWord(v, pt.stores_ranked) : `${v}`),
  });
  const axisY = panels.at(-1)!.bottom + 22;
  const H = axisY + 6;
  const xs = linePaths(hasNext ? [...w.points.map(() => 0), 0] : w.points.map(() => 0), { width: W, height: H, left: LEFT, right: RIGHT, top: 0, bottom: 0, lo: 0, hi: 1 }).x;
  const aria = w.points.map((x) => `${x.label}: ${[SHOW_SCORE && x.score !== null ? `${SCORE_LABEL.toLowerCase()} ${x.score}%` : null, x.rank !== null && x.stores_ranked ? `posicionamento ${positionLabel(x.rank, x.stores_ranked)}` : null].filter(Boolean).join(", ")}`).join("; ");

  return (
    <section className="card pad stack tl" aria-labelledby="tlh">
      <div className="row-flex between">
        <h2 id="tlh">{label}</h2>
        {next ? <span className="small muted">{next}</span> : null}
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${aria}${w.next ? `; próximo raio-X ${w.next.label}` : ""}`}>
          {panels.map((panel) => (
            <PanelSvg key={panel.key} panel={panel} points={w.points} hasNext={hasNext} height={H} />
          ))}
          {w.points.map((x, i) => (
            <text key={x.xray_id} className={`axis${x.current ? " cur" : ""}`} x={xs(i)} y={axisY} textAnchor="middle">
              {x.label}
            </text>
          ))}
          {w.next ? (
            <text className="axis" x={xs(w.points.length)} y={axisY} textAnchor="middle">
              {w.next.label}
            </text>
          ) : null}
        </svg>
      </div>
      <span className="xs muted">Embaixo, preço de entrada; em cima, premium. Itens alinhados conta pratos e itens exatos.</span>
      {w.single ? <p className="small" style={{ margin: 0 }}>O histórico começa aqui. A cada raio-X somamos um ponto.</p> : null}
      {p.mode === "screen" ? (
        <Link className="small no-print" href={`/app/raio-x/${p.monitorId}/historico`}>
          Ver histórico
        </Link>
      ) : null}
    </section>
  );
}
