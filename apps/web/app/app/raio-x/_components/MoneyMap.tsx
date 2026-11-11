// P23 "Onde está o peso do seu cardápio" (D83, Marlon, 10/nov): the 80:20 of the whole menu, first. Without sales, each
// section weighs the prices of its items; the fewest sections that make 80% are the core, and the screen says how much
// of that core this run could compare. The store's own "mais pedidos" come next, each with how it was read, so the
// owner sees at once what the X-ray can and cannot tell. No price advice here.
import type { MenuWeightItem } from "@/lib/monitor/load";
import { kindWords, menuWeight } from "@/lib/monitor/view";
import { money } from "@/lib/xray/format";

export default function MoneyMap({ items, comp, storesRead }: { items: MenuWeightItem[]; comp: boolean; storesRead: number }) {
  if (items.length === 0) return null;
  const m = menuWeight(items);
  const whose = comp ? "do cardápio dele" : "do seu cardápio";
  return (
    <section className="card pad mmap" aria-labelledby="mmh">
      <p className="eyebrow">Onde está o peso {whose}</p>
      <h2 className="headline" id="mmh">
        {m.core.length} de {m.sections.length} seções concentram {m.coreShare}% do cardápio. Comparamos {m.coreComparedPct}% desse peso.
      </h2>
      <ul className="mmlist">
        {m.sections.map((s) => (
          <li key={s.section} className={m.core.includes(s.section) ? "core" : undefined}>
            <span className="mmname">{s.section}</span>
            <span className="mmbar" aria-hidden="true">
              <i className="mmw" style={{ width: `${Math.max(s.share * 100, 1)}%` }}>
                <i className="mmc" style={{ width: `${s.comparedShare * 100}%` }} />
              </i>
            </span>
            <span className="mmv">
              {Math.round(s.share * 100)}% · {s.compared} de {s.items} comparados
            </span>
          </li>
        ))}
      </ul>
      <p className="mmkey small muted">
        <i className="mmw sw" aria-hidden="true" /> peso da seção no cardápio <i className="mmc sw" aria-hidden="true" /> parte comparada
      </p>
      {m.mostOrdered.length > 0 ? (
        <div className="mmtop">
          <h3>Mais pedidos {comp ? "dele" : "da casa"}</h3>
          <ul>
            {m.mostOrdered.map((i) => (
              <li key={i.item_id} className={i.kind === "sem" ? "none" : undefined}>
                <span className="mmname">{i.name}</span>
                <span className="mmv">{money(i.price_cents)}</span>
                <span className="mmk">{kindWords(i.kind, i.reason, storesRead)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
