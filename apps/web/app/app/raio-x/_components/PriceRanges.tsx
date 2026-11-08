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
        <p className="rngnote">Comparamos por tipo de prato, não item a item: não sabemos o tamanho nem a qualidade do que cada loja serve. Só você sabe se o seu é maior ou melhor.</p>
      </div>
      <p className="rngnote">Acima da faixa faz sentido se o seu for maior ou melhor. Se o do vizinho for maior pelo mesmo preço, fica difícil defender.</p>
      <ul className="rnglist">
        {items.map((i) => (
          <li key={i.item_id} className="rng">
            <b>{i.name}</b>
            <span className="rngv">
              {i.basis ? `${i.basis[0].toUpperCase()}${i.basis.slice(1)} por perto` : "Lojas por perto"}: {money(i.low_cents)} a {money(i.high_cents)} ({i.stores} lojas). {comp ? "Ele" : "Você"}: {money(i.own_cents)}.
            </span>
            <span className="rngp">{POSITION_LABEL[i.position]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
