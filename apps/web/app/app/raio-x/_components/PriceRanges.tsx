// P23 "Referência de faixa" (M1-13, D74; no drawing): food with no size written, compared by range only. No parity, no
// suggestion and no price gap: the same name does not make the same portion. Same block on screen and in the PDF.
import type { PriceRangeItem } from "@/lib/monitor/load";
import { money } from "@/lib/xray/format";

const POSITION_LABEL: Record<PriceRangeItem["position"], string> = {
  abaixo: "abaixo da faixa",
  dentro: "dentro da faixa",
  acima: "acima da faixa",
};

export default function PriceRanges({ items, comp }: { items: PriceRangeItem[]; comp: boolean }) {
  if (items.length === 0) return null;
  return (
    <section className="card rngs" aria-labelledby="rngh">
      <div>
        <h3 id="rngh">Referência de faixa</h3>
        <p className="rngnote">Comida sem tamanho escrito não dá para comparar item a item, porque a porção pode ser outra. Aqui é só referência: o que lojas por perto cobram por itens parecidos.</p>
      </div>
      <ul className="rnglist">
        {items.map((i) => (
          <li key={i.item_id} className="rng">
            <b>{i.name}</b>
            <span className="rngv">
              Lojas por perto: {money(i.low_cents)} a {money(i.high_cents)} ({i.stores} lojas). {comp ? "Ele" : "Você"}: {money(i.own_cents)}.
            </span>
            <span className="rngp">{POSITION_LABEL[i.position]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
