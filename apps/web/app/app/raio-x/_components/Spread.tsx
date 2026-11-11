// P23 "Ver os preços da vizinhança" (D80, D83): one chart for every item. One dot per store (no store identified), the
// own price highlighted, the middle (exact items) or the band (range items), and the stores in the region's thirds:
// entrada, intermediário, premium. Collapsed by default, the same on screen and in the PDF.
import { spreadChart, type SpreadMark } from "@/lib/monitor/view";
import { money } from "@/lib/xray/format";

export default function Spread({ prices, own, who, mark }: { prices: number[]; own: number; who: string; mark: SpreadMark }) {
  if (prices.length === 0) return null;
  const s = spreadChart(prices, own, who, mark);
  return (
    <details className="lojas">
      <summary>Ver os preços da vizinhança</summary>
      <div className="pz">
        {s.sentence ? <p className="pz-s">{s.sentence}</p> : null}
        <div className="pz-row">
          <span className="end">{money(s.lo)}</span>
          <div className="track" role="img" aria-label={`${s.sentence ?? ""} ${s.mark.text}. Preços de ${money(s.lo)} a ${money(s.hi)}.`}>
            <span className={`tag you a-${s.own.align}`} style={{ left: `${s.own.left}%` }} aria-hidden="true">
              {s.who} {money(own)}
            </span>
            <div className="pz-dots" style={{ height: s.levels * 12 }} aria-hidden="true">
              {s.mark.kind === "faixa" ? <i className="pz-band" style={{ left: `${s.mark.left}%`, width: `${s.mark.width}%` }} /> : <i className="pz-med" style={{ left: `${s.mark.left}%` }} />}
              {s.dots.map((d, k) => (
                <i key={k} className={`pz-dot${d.me ? " me-dot" : ""}`} style={{ left: `${d.left}%`, bottom: d.level * 12 }} />
              ))}
            </div>
            <span className={`tag md a-${s.mark.kind === "meio" ? s.mark.align : "c"}`} style={{ left: `${s.mark.kind === "meio" ? s.mark.left : s.mark.left + s.mark.width / 2}%` }} aria-hidden="true">
              {s.mark.text}
            </span>
          </div>
          <span className="end">{money(s.hi)}</span>
        </div>
        <dl className="pz-zones">
          {s.zones.map((z) => (
            <div key={z.tier} className={z.mine ? "mine" : undefined}>
              <dt>
                {z.label}
                {z.mine ? ` · ${who}` : ""}
              </dt>
              <dd>
                {z.count} {z.count === 1 ? "loja" : "lojas"}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
