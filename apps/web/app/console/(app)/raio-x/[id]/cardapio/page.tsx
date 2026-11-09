// The collected menu of the X-ray's target or of a store of its neighborhood, as of its latest capture. No drawing
// (05 §A): built on the console's own parts. Read only.
import { notFound } from "next/navigation";
import { ConsoleMain, FictitiousLabel } from "@/components/console";
import { Notice, SecondaryLink, XrayTitle, card, secondaryButton } from "@/components/xray";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { loadNeighborStoreId, loadStoreMenu, loadXrayHead } from "@/lib/xray/load";
import { capturedAtLabel, choiceRuleLabel, menuView, optionPriceLabel, originalPriceLabel, priceLabel, sizeLabel, type MenuItem } from "@/lib/xray/menu";

export const metadata = { title: "Cardápio coletado · MargoAI" };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Item({ item }: { item: MenuItem }) {
  const original = originalPriceLabel(item);
  const size = sizeLabel(item);
  const type = item.item_type && item.item_type !== "DEFAULT" ? item.item_type : null;
  return (
    <li className="flex flex-col gap-1.5 border-b border-border-subtle px-4 py-3 text-md">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <span className="min-w-0 flex-[1_1_240px]">
          <b>{item.name}</b>
          {size || type ? <span className="text-xs text-ink-muted"> {[size, type].filter(Boolean).join(" · ")}</span> : null}
        </span>
        <span className="text-right font-mono whitespace-nowrap">
          {original ? <span className="mr-2 text-xs text-ink-muted line-through">{original}</span> : null}
          {priceLabel(item)}
        </span>
      </div>
      {item.description ? <p className="m-0 text-sm text-ink-muted">{item.description}</p> : null}
      {item.groups.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-muted">{count(item.groups.length, "grupo de complementos", "grupos de complementos")}</summary>
          <div className="mt-2 flex flex-col gap-3">
            {item.groups.map((g, i) => (
              <div key={i}>
                <div>
                  <b>{g.name}</b> <span className="text-xs text-ink-muted">{choiceRuleLabel(g.min, g.max)}</span>
                </div>
                <ul className="m-0 mt-1 list-none p-0">
                  {g.options.map((o, j) => (
                    <li key={j} className="flex justify-between gap-4 py-0.5">
                      <span className="min-w-0">{o.name}</span>
                      <span className="font-mono text-xs whitespace-nowrap text-ink-muted">{optionPriceLabel(o.price_cents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </li>
  );
}

export default async function MenuPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ loja?: string }> }) {
  await requireConsole("clients");
  const db = adminClient();
  const x = await loadXrayHead(db, (await params).id);
  if (!x) notFound();
  await requireFlag("m1.raio_x", x.accountId);
  const { loja } = await searchParams;
  const storeId = loja ? await loadNeighborStoreId(db, x.id, loja) : x.targetStoreId;
  if (!storeId) notFound();
  const store = await loadStoreMenu(db, storeId);
  const menu = menuView(store.rows);
  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <XrayTitle code="Cardápio" store={store.name} title="Cardápio coletado" lead={menu.lastCollectedAt ? `Última coleta em ${capturedAtLabel(menu.lastCollectedAt)}.` : undefined} />
        <div className="flex flex-wrap items-center gap-2.5">
          {x.synthetic && <FictitiousLabel />}
          {store.url ? (
            <a href={store.url} target="_blank" rel="noopener noreferrer" className={secondaryButton}>
              Abrir no iFood
            </a>
          ) : null}
          <SecondaryLink href={`/console/raio-x/${x.id}`}>Voltar ao raio-X</SecondaryLink>
        </div>
      </div>
      {menu.total === 0 ? (
        <Notice tone="muted">Nenhum cardápio coletado para esta loja.</Notice>
      ) : (
        <>
          <p className="m-0 text-md text-ink-muted">
            {count(menu.total, "item", "itens")} · {count(menu.sections.length, "seção", "seções")} · {menu.withChoices} com complementos
          </p>
          {menu.sections.map((s) => (
            <section key={s.name} className={card} aria-label={s.name}>
              <div className="flex justify-between gap-3 border-b border-border px-4 py-3.5 text-md">
                <b>{s.name}</b>
                <span className="text-ink-muted">{count(s.items.length, "item", "itens")}</span>
              </div>
              <ul className="m-0 list-none p-0">
                {s.items.map((i) => (
                  <Item key={i.id} item={i} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </ConsoleMain>
  );
}
