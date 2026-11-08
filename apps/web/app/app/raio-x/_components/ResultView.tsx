// P23 (phone) / W14 (computer): "Resultado do raio-X", the delivery itself; the PDF is this page printed (Marlon, 07/nov),
// so /imprimir/raio-x/[xray] renders the same component with mode "print". Numbers: M1-05 parity ("meio da vizinhança"),
// M1-06 gap, M1-07 reading, M1-08 Pareto, M1-09 top items, M1-10 position, M1-12 score (PriceScore.tsx, provisional).
// Money-free wording: a price gap is "diferença de preço por venda", never profit.
import Link from "next/link";
import type { ReactNode } from "react";
import type { HeadToHead, History, ItemLists, MonitorStatus, Opportunities as OpportunitiesData, ResultItem, ResultPage, TestPlan as TestPlanData } from "@/lib/monitor/load";
import { printVersion } from "@/lib/monitor/print";
import { GROUP_LABEL, type Group } from "@/lib/monitor/rules";
import { brl, dayMon, gapWords, headline, longWeekdayDayMon, ordinal, paretoSentence, positionChange, positionWords, readingGroups, storeListWithOwn, stripGeometry, type ReadingKey } from "@/lib/monitor/view";
import NavSelect from "@/components/NavSelect";
import NeighborMap from "./NeighborMap";
import { CategoryScore, ScoreCard, ScoreMethod } from "./PriceScore";
import NextSteps from "./NextSteps";
import Opportunities from "./Opportunities";
import PriceRanges from "./PriceRanges";
import ShareMenu from "./ShareMenu";
import TestButton from "./TestButton";
import TestPlan from "./TestPlan";
import Timeline from "./Timeline";
import PrintOpen from "./PrintOpen";
import { Crumb, Fict } from "./ui";

export interface ResultViewProps {
  page: ResultPage;
  monitorId: string;
  storeName: string;
  everyDays: number;
  onlyYours: ItemLists["only_yours"];
  runs: { xray_id: string; on: string }[];
  synthetic: boolean;
  minItems: number;
  mode: "screen" | "print";
  /** Continuity (Marlon, 08/nov: a result is a point of the monitoring, not an end): timeline, test plan, next steps. */
  continuity?: {
    history: History["runs"];
    nextRunAt: string | null;
    status: MonitorStatus;
    plan: TestPlanData | null;
    canEdit: boolean;
    competitorAllowed: boolean;
    /** AI opportunities of the run, already null when m1.oportunidades_ia is off for the account. */
    opportunities: OpportunitiesData | null;
  };
}

const RCLS: Record<ReadingKey, string> = { pode_subir: "up", na_media: "mid", nao_mexer: "hold" };

const GROUPS_OWN: Record<ReadingKey, [string, string]> = {
  pode_subir: ["Espaço para subir", "10% ou mais abaixo do meio da vizinhança. É uma sugestão: subir aumenta o que entra por venda, mas pode diminuir as vendas."],
  na_media: ["Na média", "Menos de 10% de diferença do meio. Nada a fazer agora."],
  nao_mexer: ["Não mexa sem saber o custo", "10% ou mais acima do meio."],
};
const GROUPS_COMP: Record<ReadingKey, [string, string]> = {
  pode_subir: ["Mais barato que a vizinhança", "10% ou mais abaixo do meio."],
  na_media: ["Na média", "Menos de 10% de diferença do meio."],
  nao_mexer: ["Mais caro que a vizinhança", "10% ou mais acima do meio."],
};

function Strip({ it, who }: { it: ResultItem; who: string }) {
  const g = stripGeometry(it);
  const cls = it.reading === "nao_mexer" ? " hi" : it.reading === "na_media" ? " na" : "";
  return (
    <div className="pstrip" role="img" aria-label={`${who} ${brl(it.own_cents)}; meio da vizinhança ${brl(it.parity_cents)}; vizinhos de ${brl(g.neighborsLo)} a ${brl(g.neighborsHi)} em ${it.stores ?? 0} lojas`}>
      <span className="end" aria-hidden="true">
        {brl(g.lo)}
      </span>
      <div className="track" aria-hidden="true">
        <span className={`tag you a-${g.ownAlign}`} style={{ left: `${g.own}%` }}>
          {who} {brl(it.own_cents)}
        </span>
        <div className="bar2">
          <div className="range" style={{ left: `${g.range.left}%`, width: `${g.range.width}%` }} />
          <div className="med" style={{ left: `${g.med}%` }} />
          <div className={`me${cls}`} style={{ left: `${g.own}%` }} />
        </div>
        <span className={`tag md a-${g.medAlign}`} style={{ left: `${g.med}%` }}>
          meio {brl(it.parity_cents)}
        </span>
      </div>
      <span className="end" aria-hidden="true">
        {brl(g.hi)}
      </span>
    </div>
  );
}

function ItemRow({ it, comp, who, ownLabel, stores, print, test }: { it: ResultItem; comp: boolean; who: string; ownLabel: string; stores: { name: string; price_cents: number }[]; print: boolean; test?: ReactNode }) {
  let next: ReactNode = null;
  if (!comp && it.reading === "pode_subir")
    next = (
      <p className="next">
        Espaço para subir até <b>{brl(it.parity_cents)}</b>, o meio da vizinhança: <b className="up">{brl(it.parity_cents - it.own_cents)} de diferença por venda</b>.
      </p>
    );
  else if (!comp && it.full_price_room && it.parity_full_cents !== null && it.gap_full_pct !== null)
    next = (
      <p className="next">
        Espaço para subir quando os vizinhos não estão em promoção. Sem as promoções, o meio seria {brl(it.parity_full_cents)} e você estaria {gapWords(it.gap_full_pct)}.
      </p>
    );
  const rows = storeListWithOwn(stores, { name: ownLabel, price_cents: it.own_cents }, it.parity_cents);
  return (
    <div className="it" data-item={it.name}>
      <div>
        <div className="it-h">
          <b>{it.name}</b>
          <span className={`gap ${RCLS[it.reading]}`}>{gapWords(it.gap_pct)}</span>
        </div>
        <span className="xs muted">
          {GROUP_LABEL[it.group]} · {it.stores ?? stores.length} {(it.stores ?? stores.length) === 1 ? "loja vizinha vende" : "lojas vizinhas vendem"}
        </span>
        {next}
        {test}
      </div>
      <Strip it={it} who={who} />
      {stores.length && !print ? (
        <details className="lojas">
          <summary>Ver as lojas ({stores.length})</summary>
          <ol className="sl" aria-label={`Lojas que vendem ${it.name}, do menor para o maior preço`}>
            {rows.map((r, i) => (
              <li key={i} className={`${r.me ? "me-row" : ""} ${r.middle ? "meio-row" : ""}`}>
                <span>
                  {r.name}
                  {r.middle ? <span className="xs muted"> · o meio</span> : null}
                </span>
                <span className="mono">{brl(r.price_cents)}</span>
              </li>
            ))}
          </ol>
          <p className="xs muted" style={{ margin: "6px 0 0" }}>
            Do menor para o maior preço.
          </p>
        </details>
      ) : null}
    </div>
  );
}

/** A collapsible card on screen; a plain section in print, since Chromium overlaps a <details> split across pages. */
function Fold({ print, open, children, ...rest }: { print: boolean; open: boolean; className: string; children: ReactNode; "data-category"?: string }) {
  return print ? <section {...rest}>{children}</section> : (
    <details {...rest} open={open}>
      {children}
    </details>
  );
}

/** Stores whose menus this run read (capture slots that finished); a run without captures (seed, before D47d) counts
 *  the stores it compares with. */
const storesRead = (r: ResultPage["result"]) => (r.stores_read > 0 ? r.stores_read : r.stores_compared);

/** P23 "Como fizemos este raio-X" (Marlon, 08/nov: more didactic): the method in three steps with this run's numbers
 *  (M1-01 neighborhood and capture slots, M1-04 pairing, M1-05 parity) and the three M1-07 readings with what each asks. */
function MethodSteps({ r, comp, compared, map }: { r: ResultPage["result"]; comp: boolean; compared: number; map: ResultPage["map"] }) {
  const his = comp ? "dele" : "seus";
  return (
    <section className={`card mhow${map ? " withmap" : ""}`} aria-labelledby="stepsh">
      <p className="eyebrow" id="stepsh">
        Como fizemos este raio-X
      </p>
      {map ? <NeighborMap map={map} comp={comp} /> : null}
      <ol className="mhow3">
        <li>
          <b>Lemos {storesRead(r)} lojas vizinhas</b>
          <span>
            Num raio de {r.radius_km} km, só o que está público no iFood em {dayMon(r.on)}.
          </span>
        </li>
        <li>
          <b>
            Achamos {compared} {compared === 1 ? "produto igual" : "produtos iguais"} aos {his}
          </b>
          <span>Mesmo produto, tamanho e sabor. {comp ? "Os itens só dele" : "Os itens só seus"} ficam à parte.</span>
        </li>
        <li>
          <b>Olhamos o preço do meio</b>
          <span>Para cada produto, metade das lojas cobra menos que o meio e metade cobra mais.</span>
        </li>
      </ol>
      <dl className="mhowl">
        <div>
          <dt className="up">{comp ? "Mais barato" : "Espaço para subir"}</dt>
          <dd>{comp ? "10% ou mais abaixo do meio." : "10% ou mais abaixo do meio. Teste subir um item por vez e acompanhe no próximo raio-X."}</dd>
        </div>
        <div>
          <dt className="mid">Na média</dt>
          <dd>{comp ? "Menos de 10% de diferença do meio." : "Menos de 10% de diferença do meio. Nada a fazer agora."}</dd>
        </div>
        <div>
          <dt className="hold">{comp ? "Mais caro" : "Não mexa sem saber o custo"}</dt>
          <dd>{comp ? "10% ou mais acima do meio." : "10% ou mais acima do meio. Antes de baixar, confira quanto custa fazer o item."}</dd>
        </div>
      </dl>
    </section>
  );
}

function HeadToHeadBlock({ h, name }: { h: HeadToHead; name: string }) {
  const less = h.items.filter((i) => i.their_cents < i.own_cents).length;
  const more = h.items.filter((i) => i.their_cents > i.own_cents).length;
  const dif = (i: HeadToHead["items"][number]) => (i.their_cents === i.own_cents ? "mesmo preço" : `ele cobra ${brl(Math.abs(i.their_cents - i.own_cents))} a ${i.their_cents < i.own_cents ? "menos" : "mais"}`);
  return (
    <section className="card money" aria-labelledby="hl">
      <p className="eyebrow">Você e o {name}</p>
      <h2 className="headline" id="hl">
        Nos {h.items.length} itens que vocês dois vendem, o {name} cobra menos que você em {less} e mais em {more}.
      </h2>
      <ol className="t3 h2h">
        <li className="hd">
          <span>Item</span>
          <span className="r">Você</span>
          <span className="r">{name.length > 12 ? "Ele" : name}</span>
          <span className="dif" />
        </li>
        {h.items.map((i) => (
          <li key={i.item_id}>
            <span>{i.name}</span>
            <span className="r">{brl(i.own_cents)}</span>
            <span className="r">{brl(i.their_cents)}</span>
            <span className={`dif small ${i.their_cents < i.own_cents ? "hold" : i.their_cents > i.own_cents ? "up" : "mid"}`}>{dif(i)}</span>
          </li>
        ))}
      </ol>
      <p className="xs muted" style={{ margin: 0 }}>
        Seus preços vêm do seu raio-X de {dayMon(h.on)} da {h.own_store_name}.
      </p>
    </section>
  );
}

export default function ResultView(p: ResultViewProps) {
  const { result: r, stores, headToHead } = p.page;
  const comp = r.target_kind === "competitor";
  const print = p.mode === "print";
  const name = p.storeName;
  const who = comp ? "ele" : "você";
  const pend = comp ? 0 : r.doubts_open;
  const compared = r.items_analyzed;
  const prevOn = r.previous_position ? (p.runs.find((x) => x.xray_id === r.previous_position!.xray_id)?.on ?? null) : null;
  const top = headline(r.top_raise);
  const G = comp ? GROUPS_COMP : GROUPS_OWN;
  const cats = r.by_category.filter((c) => c.group !== "so_seus" && c.items_compared > 0);
  const firstOpen = [...cats].sort((a, b) => b.price_gap_per_sale_cents - a.price_gap_per_sale_cents)[0]?.group;
  const catPos = new Map(r.positions.by_category.map((c) => [c.group, c]));
  const position = r.position;
  const words = position ? positionWords(position.rank, position.stores_ranked, comp ? `O ${name}` : "você") : null;
  const change = position ? positionChange(position, r.previous_position, prevOn, p.everyDays) : null;
  const cont = p.continuity;
  const plan = cont?.plan ?? null;
  // "Vou testar" on own-store runs, on the screen (the test plan prints as its own section).
  const testFor = (it: ResultItem) => {
    if (!cont || !plan || comp || print) return undefined;
    const ownItemId = plan.own_item_ids[it.item_id];
    if (!ownItemId) return undefined;
    return (
      <TestButton
        monitorId={p.monitorId}
        xrayId={r.xray_id}
        ownItemId={ownItemId}
        marked={plan.items.some((t) => t.own_item_id === ownItemId)}
        canEdit={cont.canEdit}
        full={plan.active >= plan.max_items}
        maxItems={plan.max_items}
      />
    );
  };

  const howList = (
    <ul className="howl">
      <li>Comparamos só preços públicos dos mesmos produtos nas lojas perto {comp ? "dele" : "de você"}.</li>
      <li>Não sabemos {comp ? "o custo dele nem quantas unidades ele vende" : "o seu custo nem quantas unidades você vende"}.</li>
      <li>
        Dois caminhos: <b>subir o preço</b> aumenta o que entra por venda, mas pode diminuir as vendas. <b>Manter ou ajustar o preço</b> pode ajudar a vender mais.
      </li>
      <li>O equilíbrio certo depende do custo e do volume, que ainda não estão neste raio-X.</li>
      {comp ? null : <li>Use as sugestões como ponto de partida: mude um item por vez e acompanhe semana a semana aqui.</li>}
      <li>Ainda não mostramos uma faixa de confiança nos preços. Ela vem quando o custo dos itens for conhecido.</li>
    </ul>
  );

  const catSection = (c: (typeof cats)[number]) => {
    const list = r.items.filter((i) => i.group === c.group);
    const groups = readingGroups(list);
    const label = GROUP_LABEL[c.group as Group] ?? c.group;
    return (
      <Fold key={c.group} print={print} className="card catc" open={c.group === firstOpen} data-category={label}>
        <summary>
          <h3>{label}</h3>
          <span className="csum">
            <span>{c.items_compared} comparados</span>
            {comp ? (
              <>
                <span className="up">
                  {c.can_go_up} mais {c.can_go_up === 1 ? "barato" : "baratos"}
                </span>
                <span className="hold">
                  {c.leave_alone} mais {c.leave_alone === 1 ? "caro" : "caros"}
                </span>
              </>
            ) : (
              <>
                <span className={c.can_go_up ? "up" : ""}>{c.can_go_up} com espaço para subir</span>
                <span className={c.leave_alone ? "hold" : ""}>{c.leave_alone} não mexa</span>
                {c.price_gap_per_sale_cents > 0 ? <span className="amt">{brl(c.price_gap_per_sale_cents)} de diferença por venda</span> : null}
              </>
            )}
            <CategoryScore score={catPos.get(c.group as Group)?.score} minItems={p.minItems} />
          </span>
        </summary>
        {groups.map((g) => (
          <div className="rg" key={g.reading}>
            <div className="rgh">
              <span className={`gt ${RCLS[g.reading]}`}>{G[g.reading][0]}</span>
              <span className="gn">{g.items.length}</span>
              <span className="gs">{G[g.reading][1]}</span>
            </div>
            {g.reading === "nao_mexer" && !comp ? <p className="gwhy">Sem saber quanto custa fazer cada item, baixar o preço pode deixar a venda no prejuízo. Antes de mexer, confira o custo.</p> : null}
            {g.items.map((it) => (
              <ItemRow key={it.item_id} it={it} comp={comp} who={who} ownLabel={comp ? `${name} (esta loja)` : "Você"} stores={stores[it.item_id] ?? []} print={print} test={testFor(it)} />
            ))}
          </div>
        ))}
      </Fold>
    );
  };

  return (
    <main className="rx-main" data-version={printVersion(r.version)} data-xray={r.xray_id}>
      {p.mode === "screen" ? <PrintOpen /> : null}
      <div className={print ? "row-flex between" : "print-only"}>
        <span className="row-flex between" style={{ width: "100%" }}>
          <b>MargoAI · Raio-X de preço</b>
          {p.synthetic ? <span className="synthetic-mark">SINTÉTICO</span> : null}
        </span>
      </div>
      {print ? null : <Crumb>{name}</Crumb>}
      <div className="head">
        <div>
          <h1>{comp ? `Como o ${name} se posiciona` : "Raio-X de preço"}</h1>
          <p className="lead">
            {name} · raio-X de {longWeekdayDayMon(r.on)}
          </p>
        </div>
        <div className="row-flex no-print">
          <Fict synthetic={p.synthetic} />
          {print ? null : <ShareMenu monitorId={p.monitorId} xrayId={r.xray_id} />}
        </div>
      </div>
      {print ? null : (
        <div className="resacts">
          {p.runs.length > 1 ? (
            <label className="row-flex" style={{ gap: 6 }}>
              Outro raio-X{" "}
              <NavSelect
                label="Escolher raio-X"
                value={r.xray_id}
                options={[...p.runs].reverse().map((x, i) => ({ value: x.xray_id, label: dayMon(x.on), href: i === 0 ? `/app/raio-x/${p.monitorId}` : `/app/raio-x/${p.monitorId}/${x.xray_id}` }))}
              />
            </label>
          ) : null}
          <Link href={`/app/raio-x/${p.monitorId}/historico`}>Histórico</Link>
          {pend ? <Link href={`/app/raio-x/${p.monitorId}/revisar`}>Itens em dúvida ({pend})</Link> : null}
        </div>
      )}
      {cont ? <Timeline monitorId={p.monitorId} xrayId={r.xray_id} runs={cont.history} nextRunAt={cont.nextRunAt} status={cont.status} mode={p.mode} /> : null}
      {pend ? (
        <div className="banner">
          <span>Calculado sem {pend} itens em dúvida. Responda para completar.</span>
          {print ? null : (
            <Link className="btn sm no-print" href={`/app/raio-x/${p.monitorId}/revisar`}>
              Responder agora
            </Link>
          )}
        </div>
      ) : null}
      {r.stores_read < r.stores_total ? (
        <div className="banner neutral">
          <span>
            Comparado com {r.stores_read} de {r.stores_total} lojas.
          </span>
        </div>
      ) : null}
      <MethodSteps r={r} comp={comp} compared={compared} map={p.page.map} />
      {print ? null : (
        <details className="card how">
          <summary>
            <b>Antes de mudar preços</b>
            <span className="small muted">Preço público, sem custo nem volume de vendas.</span>
          </summary>
          {howList}
        </details>
      )}
      <ScoreCard result={r} previousOn={prevOn} competitor={comp} />
      <div className="lead2">
        {!comp ? (
          <section className="card money" aria-labelledby="hl">
            <p className="eyebrow">O que este raio-X mostra</p>
            {top.count ? (
              <>
                <h2 className="headline" id="hl">
                  {top.count} {top.count === 1 ? "item está" : "itens estão"} bem abaixo do preço do meio da vizinhança: até <span className="amt">{brl(top.max)} de diferença por venda</span>.
                </h2>
                <ol className="t3">
                  {r.top_raise.map((i) => (
                    <li key={i.item_id}>
                      <b style={{ fontWeight: 600 }}>{i.name}</b>
                      <span className="pr">
                        você {brl(i.own_cents)} · meio {brl(i.parity_cents)}
                      </span>
                      <span className="gain">{brl(i.parity_cents - i.own_cents)} por venda</span>
                    </li>
                  ))}
                </ol>
                <p className="small muted" style={{ margin: 0 }}>
                  {top.count > 1 ? `Somando um de cada, ${brl(top.sum)} de diferença por venda. ` : ""}É diferença de preço, não lucro: subir pode mudar quanto você vende. {paretoSentence(r.pareto_count, compared) ?? ""}
                </p>
              </>
            ) : (
              <h2 className="headline" id="hl">
                Nenhum item está 10% ou mais abaixo do meio da vizinhança.
              </h2>
            )}
          </section>
        ) : headToHead ? (
          <HeadToHeadBlock h={headToHead} name={name} />
        ) : null}
        {position && words ? (
          <section className="card posc" aria-labelledby="posh">
            <p className="eyebrow" id="posh">
              Preço perto {comp ? "dele" : "de você"}
            </p>
            <p className="posline">
              <b>{words.lead}</b>, nos itens em comum. {words.tail}
            </p>
            <div role="img" aria-label={`Posição ${position.rank} de ${position.stores_ranked}, da loja mais barata para a mais cara`}>
              <div className="rank" style={{ gridTemplateColumns: `repeat(${position.stores_ranked}, minmax(0, 1fr))` }}>
                {Array.from({ length: position.stores_ranked }, (_, i) => (
                  <i key={i} className={i === position.rank - 1 ? "you" : i < position.rank - 1 ? "cheaper" : ""} />
                ))}
              </div>
              <div className="rankl">
                <span>mais barata</span>
                <span>
                  {ordinal(position.rank)} de {position.stores_ranked}
                </span>
                <span>mais cara</span>
              </div>
            </div>
            {change ? <span className="chg">{change}</span> : null}
            {print ? null : (
              <Link className="small no-print" href={`/app/raio-x/${p.monitorId}/historico`}>
                Ver ao longo do tempo
              </Link>
            )}
          </section>
        ) : null}
      </div>
      {cont ? <Opportunities data={cont.opportunities} competitor={comp} /> : null}
      {cont ? <TestPlan plan={plan} monitorId={p.monitorId} canEdit={cont.canEdit} mode={p.mode} /> : null}
      <section className="stack" aria-labelledby="allh" style={{ gap: 10 }}>
        <div className="row-flex between">
          <h2 id="allh">Por categoria</h2>
          <span className="small muted">{compared} itens comparados</span>
        </div>
        {cats.map(catSection)}
        <PriceRanges items={p.page.ranges} comp={comp} />
        {p.onlyYours.length ? (
          <Fold print={print} className="card catc" open={false}>
            <summary>
              <h3>{comp ? "Itens só dele" : "Itens só seus"}</h3>
              <span className="csum">
                <span>{p.onlyYours.length} itens</span>
                <span>ninguém por perto vende algo igual</span>
              </span>
            </summary>
            <div className="rg">
              {p.onlyYours.map((i) => (
                <div className="it it-only" key={i.item_id}>
                  <span>{i.name}</span>
                  <span className="xs muted">sem comparação</span>
                </div>
              ))}
            </div>
          </Fold>
        ) : null}
      </section>
      {cont ? (
        <NextSteps
          monitorId={p.monitorId}
          targetKind={r.target_kind}
          testCount={plan?.active ?? 0}
          maxItems={plan?.max_items ?? 3}
          nextRunAt={cont.nextRunAt}
          status={cont.status}
          competitorAllowed={cont.competitorAllowed}
          mode={p.mode}
        />
      ) : null}
      <section className="card method" aria-label="Como calculamos">
        <p>
          <b>Como calculamos.</b> {comp ? "As" : "Comparamos com as"} {storesRead(r)} lojas vizinhas num raio de {r.radius_km} km, só com o que está público no iFood em {dayMon(r.on)}. O meio da vizinhança é o preço do meio dos itens iguais ao{" "}
          {comp ? "dele" : "seu"} (mesmo produto, tamanho e sabor), só quando lojas suficientes vendem o item. Quando os vizinhos estão em promoção, também olhamos o preço cheio deles.
        </p>
        <p>
          {compared} itens comparados.{comp ? "" : ` Itens só seus: ${r.only_yours}, ninguém por perto vende algo igual.`} Valores por venda, sem saber quantas unidades {comp ? "ele vende" : "você vende"}. Sem dado de custo.
        </p>
        <ScoreMethod competitor={comp} minItems={p.minItems} />
        <p>
          <b>Como ler este raio-X.</b>
        </p>
        {howList}
      </section>
    </main>
  );
}
