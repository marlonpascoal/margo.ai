// C12 Ficha técnica (design/C12-Ficha.dc.html, 05 §A). Fundador and Operação; flag m3.custo (04 §6).
// Costs are worker-cost's (CST-01 latest confirmed note in 90 days, CST-02 regional prior, CST-03 yield,
// CST-04 error bar), stored on recipe and recipe_line; an edit clears them until the job recomputes.
import Link from "next/link";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  ConsoleMain,
  FictitiousLabel,
  PageTitle,
} from "@/components/console";
import { requireFlag } from "@/lib/flags";
import { accountByCode } from "@/lib/m2/account";
import { closePeriods } from "@/lib/m2/close";
import { CHANNEL_LABEL } from "@/lib/m2/format";
import { loadDishes, loadFicha } from "@/lib/m3/data";
import {
  brl2,
  errorExplanation,
  money2,
  pctInt,
  qtyLabel,
  sourceLabel,
  yieldLabel,
} from "@/lib/m3/format";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { saveLinesAction } from "./actions";

export const metadata = { title: "Ficha técnica · MargoAI" };

const th = "border-b border-border px-4 py-2.5 font-normal whitespace-nowrap";
const td = "border-b border-border-subtle px-4 py-2.5";
const input =
  "box-border min-h-9 w-20 rounded-sm border border-border-strong bg-surface px-2 text-right font-mono text-md";

export default async function FichasPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ prato?: string; editar?: string; aviso?: string }>;
}) {
  await requireConsole("clients");
  const [p, sp] = await Promise.all([params, searchParams]);
  const db = adminClient();
  const account = await accountByCode(db, p.code);
  await requireFlag("m3.custo", account.id);
  const dishes = await loadDishes(db, account.id);
  const ready = dishes.filter((d) => d.ready);
  const selected =
    dishes.find((d) => d.id === sp.prato && d.ready) ?? ready[0] ?? null;
  const ficha = selected ? await loadFicha(db, account.id, selected.id) : null;
  const latest = (await closePeriods(db, account.id))[0];
  const editing = sp.editar === "1" && ficha !== null;
  const base = `/console/contas/${account.code}/fichas`;

  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C12"
          kicker={`C12 · Módulo 3 · ${account.name} · ${ready.length} de ${dishes.length || 20} fichas prontas`}
          title="Ficha técnica"
          lead="Feita por nós na sessão de onboarding, só para os 20 itens que mais vendem. A quantidade não muda; o preço muda toda semana."
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {account.isSynthetic && <FictitiousLabel />}
          {latest && (
            <Link
              href={`/console/contas/${account.code}/contribuicao/${latest.month.slice(0, 7)}`}
              className={BUTTON_PRIMARY}
            >
              Ver contribuição
            </Link>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <nav
          aria-label="Itens do cardápio"
          className="flex min-w-0 flex-[1_1_240px] flex-col rounded-xl border border-border bg-surface"
        >
          {dishes.length === 0 && (
            <span className="px-4 py-3 text-md text-ink-muted">
              Nenhum item na lista dos 20 ainda.
            </span>
          )}
          {dishes.map((d) => (
            <Link
              key={d.id}
              href={d.ready ? `${base}?prato=${d.id}` : "#ficha"}
              aria-current={d.id === selected?.id ? "true" : undefined}
              className={`flex justify-between gap-2 border-b border-border-subtle px-4 py-3 text-md text-ink no-underline last:border-b-0 ${d.id === selected?.id ? "bg-sunken" : "bg-surface"}`}
            >
              <span>{d.name}</span>
              <span
                className={`text-xs whitespace-nowrap ${d.ready ? "text-ok" : "text-ink-muted"}`}
              >
                {d.ready ? "pronta" : "a fazer"}
              </span>
            </Link>
          ))}
        </nav>
        <section
          id="ficha"
          className="flex min-w-0 flex-[3_1_520px] flex-col rounded-xl border border-border bg-surface"
        >
          {!ficha ? (
            <p className="m-0 px-4 py-3.5 text-md text-ink-muted">
              Nenhuma ficha pronta ainda.
            </p>
          ) : (
            <form action={saveLinesAction}>
              <input type="hidden" name="conta" value={account.code} />
              <input type="hidden" name="prato" value={ficha.menuItemId} />
              <div className="flex flex-wrap justify-between gap-2 border-b border-border px-4 py-3.5">
                <b>{ficha.name}</b>
                <span className="font-mono" data-cost>
                  {ficha.costCents === null || ficha.errorPct === null
                    ? "custo recalculando"
                    : `custo ${brl2(ficha.costCents)} ± ${pctInt(ficha.errorPct)}`}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] border-collapse text-md">
                  <thead>
                    <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                      <th className={th}>Insumo</th>
                      <th className={`${th} text-right`}>No prato</th>
                      <th className={`${th} text-right`}>Rendimento</th>
                      <th className={th}>Preço de onde</th>
                      <th className={`${th} text-right`}>Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ficha.lines.map((l) => (
                      <tr key={l.id} data-line={l.ingredient}>
                        <td className={td}>{l.ingredient}</td>
                        <td className={`${td} text-right font-mono`}>
                          {editing ? (
                            <>
                              <input type="hidden" name="linha" value={l.id} />
                              <input
                                name={`qtd:${l.id}`}
                                defaultValue={String(l.qty).replace(".", ",")}
                                aria-label={`No prato, ${l.ingredient}`}
                                className={input}
                              />{" "}
                              {l.baseUnit}
                            </>
                          ) : (
                            qtyLabel(l.qty, l.baseUnit)
                          )}
                        </td>
                        <td className={`${td} text-right font-mono`}>
                          {editing ? (
                            <span className="inline-flex items-center gap-1.5">
                              <input
                                name={`rend:${l.id}`}
                                defaultValue={String(
                                  Number((l.yieldPct * 100).toFixed(2)),
                                ).replace(".", ",")}
                                aria-label={`Rendimento, ${l.ingredient}`}
                                className={input}
                              />
                              %
                              <select
                                name={`conf:${l.id}`}
                                defaultValue={l.confidence}
                                aria-label={`Rendimento ${l.ingredient}: como foi obtido`}
                                className="min-h-9 rounded-sm border border-border-strong bg-surface font-sans text-sm"
                              >
                                <option value="medido">medido</option>
                                <option value="declarado">declarado</option>
                                <option value="estimado">estimado</option>
                              </select>
                            </span>
                          ) : (
                            yieldLabel(l.yieldPct)
                          )}
                        </td>
                        <td
                          className={`${td} ${l.source === "invoice" ? "text-ok" : l.source === "regional_prior" ? "text-warn" : "text-danger"}`}
                        >
                          {sourceLabel(l.source, l.observedOn, l.model)}
                        </td>
                        <td className={`${td} text-right font-mono whitespace-nowrap`}>
                          {l.costCents === null ? "" : brl2(l.costCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 text-sm text-ink-muted">
                {errorExplanation(ficha.lines)}
              </div>
              {editing ? (
                <div className="flex flex-col gap-3 border-t border-border px-4 py-3.5">
                  {ficha.channels.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 text-md">
                      <span className="text-ink-muted">
                        Embalagem extra por canal
                      </span>
                      {ficha.channels.map((ch) => (
                        <label
                          key={ch}
                          className="inline-flex items-center gap-1.5"
                        >
                          {CHANNEL_LABEL[ch]} R$
                          <input
                            name={`emb:${ch}`}
                            defaultValue={money2(ficha.packaging[ch] ?? 0)}
                            className={input}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  {sp.aviso === "valor" && (
                    <span className="text-md text-danger">
                      Confira os valores: quantidade e rendimento maiores que
                      zero.
                    </span>
                  )}
                  <div className="flex flex-wrap gap-2.5">
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Salvar
                    </button>
                    <Link
                      href={`${base}?prato=${ficha.menuItemId}`}
                      className={BUTTON_SECONDARY}
                    >
                      Cancelar
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-md">
                  <span className="text-ink-muted">
                    {Object.entries(ficha.packaging).some(
                      ([, c]) => (c ?? 0) > 0,
                    )
                      ? `Embalagem extra: ${Object.entries(ficha.packaging)
                          .filter(([, c]) => (c ?? 0) > 0)
                          .map(
                            ([ch, c]) =>
                              `${CHANNEL_LABEL[ch as keyof typeof CHANNEL_LABEL]} ${brl2(c ?? 0)}`,
                          )
                          .join(", ")}`
                      : ""}
                  </span>
                  <Link href={`${base}?prato=${ficha.menuItemId}&editar=1`}>
                    Editar ficha
                  </Link>
                </div>
              )}
            </form>
          )}
        </section>
      </div>
    </ConsoleMain>
  );
}
