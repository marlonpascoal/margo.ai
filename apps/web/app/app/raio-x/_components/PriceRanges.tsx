// P23 "Referência de faixa" (M1-13, D74; M1-14, D81; no drawing). The conclusion first: how many dishes sit above, in or
// below their range, and the combos' mean discount. Dishes and combos are apart and never summed: a combo's reference is
// the sum of its parts, so "below" means nothing for it. A dish row is the exact items' thin strip, with the stores'
// prices collapsed under "Ver os preços da vizinhança". A combo row reads as its discount on the singles, with the
// neighbors' sum as context and the parts collapsed. No middle, no target price, no suggestion (M1-13).
import type { ReactNode } from "react";
import type { PriceRangeItem } from "@/lib/monitor/load";
import { comboDiscountLabel, isIndicativeM1_18, rangeBar, rangeSummary, sortRanges } from "@/lib/monitor/view";
import Spread from "./Spread";
import { money } from "@/lib/xray/format";

const VISIBLE = 8;
const POSITION_LABEL = { abaixo: "Abaixo da faixa", dentro: "Dentro da faixa", acima: "Acima da faixa" } as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;


function DishRow({ i, who }: { i: PriceRangeItem; who: string }) {
  const s = rangeBar(i.prices ?? [], i.own_cents, i.low_cents!, i.high_cents!);
  const stores = i.prices?.length ?? i.stores ?? 0;
  const few = isIndicativeM1_18(stores);
  return (
    <li className="rrow">
      <div className="rhead">
        <b className="rname">{i.name}</b>
        {few ? <span className="rtag">Poucas lojas</span> : null}
        <span className="rprice">{money(i.own_cents)}</span>
      </div>
      <div className="rbar" role="img" aria-label={`${POSITION_LABEL[i.position!]}: ${money(i.low_cents!)} a ${money(i.high_cents!)}, ${who} ${money(i.own_cents)}`}>
        <i className="rband" style={{ left: `${s.band.left}%`, width: `${s.band.width}%` }} />
        <i className="rme" style={{ left: `${s.own.left}%` }} />
      </div>
      <p className={`rread${i.position === "acima" ? " hi" : ""}`}>
        {POSITION_LABEL[i.position!]} ({money(i.low_cents!)} a {money(i.high_cents!)}) · {plural(stores, "loja", "lojas")}
        {i.basis ? ` · ${i.basis}` : ""}
        {few ? ". Faixa indicativa: fora da conta de itens alinhados." : ""}
      </p>
      <Spread prices={i.prices ?? []} own={i.own_cents} who={who} mark={{ kind: "faixa", low: i.low_cents!, high: i.high_cents! }} />
    </li>
  );
}

function ComboRow({ i }: { i: PriceRangeItem }) {
  return (
    <li className="rrow">
      <div className="rhead">
        <b className="rname">{i.name}</b>
        <span className="rtag">Combo</span>
      </div>
      <p className="rmain">
        <b>{money(i.own_cents)}</b> · {comboDiscountLabel(i.own_cents, i.combo_solo_cents!)}
      </p>
      {i.low_cents !== null && i.high_cents !== null ? (
        <p className="rread">
          Partes separadas por perto: {money(i.low_cents)} a {money(i.high_cents)}
        </p>
      ) : null}
      {i.combo_parts && i.combo_parts.length > 0 ? (
        <details className="lojas">
          <summary>Ver as partes</summary>
          <ul className="rparts">
            {i.combo_parts.map((p, k) => (
              <li key={k}>
                <span>
                  {p.qty} × {p.item}
                </span>
                <span className="rprice">{money(p.qty * p.price_cents)}</span>
              </li>
            ))}
          </ul>
          {i.stores ? <p className="rread">Cada parte tem preço em ao menos {plural(i.stores, "loja", "lojas")} por perto.</p> : null}
        </details>
      ) : null}
    </li>
  );
}

function UnmatchedRow({ i, read }: { i: PriceRangeItem; read: number }) {
  return (
    <li className="rrow">
      <div className="rhead">
        <b className="rname">{i.name}</b>
        <span className="rprice">{money(i.own_cents)}</span>
      </div>
      <p className="rread">Nenhuma das {read} lojas lidas vende {i.basis}. Sem comparação justa por enquanto.</p>
    </li>
  );
}

function Group<T>({ title, rows, render }: { title: string; rows: T[]; render: (r: T) => ReactNode }) {
  if (rows.length === 0) return null;
  return (
    <div className="rgrp">
      <h4>{title}</h4>
      <ul className="rlist">{rows.slice(0, VISIBLE).map(render)}</ul>
      {rows.length > VISIBLE ? (
        <details className="lojas rmore">
          <summary>Ver mais {rows.length - VISIBLE}</summary>
          <ul className="rlist">{rows.slice(VISIBLE).map(render)}</ul>
        </details>
      ) : null}
    </div>
  );
}

export default function PriceRanges({ items, comp, storesRead, storesTotal }: { items: PriceRangeItem[]; comp: boolean; storesRead: number; storesTotal: number }) {
  if (items.length === 0) return null;
  const who = comp ? "ele" : "você";
  const { dishes, combos, unmatched } = sortRanges(items);
  const sum = rangeSummary(items);
  return (
    <section className="card pad rngs" aria-labelledby="rngh">
      <div>
        <p className="eyebrow">Pratos e combos</p>
        <h3 id="rngh">Referência de faixa</h3>
        <p className="rngnote">Pratos sem tamanho escrito: comparamos por tipo de prato, não item a item. Só você sabe se o seu é maior ou melhor.</p>
      </div>
      <dl className="rsum">
        {sum.dishes > 0 ? (
          <div className={sum.above > 0 ? "hi" : ""}>
            <dt>{plural(sum.above, "prato acima da faixa", "pratos acima da faixa")}</dt>
            <dd>{sum.above > 0 ? "Sustente com diferencial: tamanho, ingrediente ou preparo." : "Nenhum acima."} {sum.inside} dentro · {sum.below} abaixo</dd>
          </div>
        ) : null}
        {sum.unmatched > 0 ? (
          <div>
            <dt>{plural(sum.unmatched, "prato sem concorrente do mesmo tipo", "pratos sem concorrente do mesmo tipo")}</dt>
            <dd>
              Nenhuma das {storesRead} lojas lidas vende o mesmo tipo. Não comparamos com o que é diferente.
              {storesTotal > storesRead ? ` Este raio-X leu ${storesRead} das ${storesTotal} lojas da vizinhança; com mais lojas lidas pode surgir comparação.` : ""}
            </dd>
          </div>
        ) : null}
        {sum.combos > 0 ? (
          <div>
            <dt>{plural(sum.combos, "combo", "combos")}</dt>
            <dd>
              {sum.comboDiscountPct !== null && sum.comboDiscountPct > 0 ? `Seus combos concedem em média ${sum.comboDiscountPct}% de desconto sobre o avulso. Confira se a margem comporta.` : "Comparados com as partes compradas avulsas."}
            </dd>
          </div>
        ) : null}
      </dl>
      <Group title="Pratos" rows={dishes} render={(i) => <DishRow key={i.item_id} i={i} who={who} />} />
      <Group title="Combos" rows={combos} render={(i) => <ComboRow key={i.item_id} i={i} />} />
      <Group title="Sem concorrente do mesmo tipo nas lojas lidas" rows={unmatched} render={(i) => <UnmatchedRow key={i.item_id} i={i} read={storesRead} />} />
    </section>
  );
}
