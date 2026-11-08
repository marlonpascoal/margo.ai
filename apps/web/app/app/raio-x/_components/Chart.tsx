// P24 line chart, server-rendered SVG (prototype chart()). Each point carries a <title> for hover; "Ver como tabela"
// (TableToggle) shows the same numbers as a table. A missing run breaks the line (draft §2.8: no interpolation).
// tokens.css has no categorical chart colors yet (draft §8): "Você" is ink-2, a competitor warn, the middle ink-muted dashed.
import { linePaths } from "@/lib/monitor/view";

export interface Series {
  name: string;
  values: (number | null)[];
  tone: "main" | "second" | "middle";
}

const STROKE: Record<Series["tone"], string> = { main: "var(--color-ink-2)", second: "var(--color-warn)", middle: "var(--color-ink-muted)" };

export function HistoryChart(p: {
  id: string;
  labels: string[];
  series: Series[];
  lo: number;
  hi: number;
  ticks: number[];
  fmt: (v: number) => string;
  label: string;
  invert?: boolean;
  short?: (s: Series, v: number) => string;
}) {
  const W = 640;
  const H = 220;
  const box = { width: W, height: H, left: 52, right: 76, top: 14, bottom: 28, lo: p.lo, hi: p.hi, invert: p.invert };
  const every = p.labels.length > 8 ? Math.ceil(p.labels.length / 6) : p.labels.length > 4 ? 2 : 1;
  const geo = linePaths(p.series[0]?.values ?? [], box);
  return (
    <div className="chart" id={p.id}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={p.label}>
        {p.ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={box.left} x2={W - box.right} y1={geo.y(t)} y2={geo.y(t)} />
            <text className="axis" x={box.left - 8} y={geo.y(t) + 4} textAnchor="end">
              {p.fmt(t)}
            </text>
          </g>
        ))}
        {p.labels.map((l, i) =>
          (p.labels.length - 1 - i) % every === 0 ? (
            <text key={i} className="axis" x={geo.x(i)} y={H - 8} textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
        {p.series.map((s, k) => {
          const g = linePaths(s.values, box);
          const lastIdx = s.values.map((v, i) => (v === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
          const last = lastIdx >= 0 ? (s.values[lastIdx] as number) : null;
          return (
            <g key={s.name}>
              {g.segments.map((pts, j) =>
                pts.includes(" ") ? (
                  <polyline key={j} fill="none" stroke={STROKE[s.tone]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.tone === "middle" ? "5 4" : undefined} points={pts} />
                ) : null,
              )}
              {s.values.map((v, i) =>
                v === null ? null : (
                  <circle key={i} cx={g.x(i)} cy={g.y(v)} r={s.tone === "middle" ? 2 : 3.5} fill={STROKE[s.tone]} stroke="var(--color-surface)" strokeWidth={1.5}>
                    <title>{`${p.labels[i]}: ${s.name} ${p.fmt(v)}`}</title>
                  </circle>
                ),
              )}
              {last !== null ? (
                <text className="lbl" x={g.x(lastIdx) + 10} y={g.y(last) + 4 + (k === 1 ? -7 : k === 2 ? 8 : 0)}>
                  {p.short ? p.short(s, last) : p.fmt(last)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
