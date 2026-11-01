// C11 De-para de insumos (design/C11-Depara.dc.html, 05 §A, D14). Fundador and Operação. Flag m3.depara_ia.
// D14, D02: a suggestion never enters a cost until a founder confirms it here.
// "Regras gerais em revisão" (D14 step 2, Marlon 31/out) has no drawing yet: copy written for it, to confirm.
import Link from "next/link";
import { BUTTON_PRIMARY, ConsoleMain, FictitiousLabel, PageTitle } from "@/components/console";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode } from "@/lib/m2/account";
import { deparaRows, flaggedRuleRows, loadCatalog, loadFlaggedRules, loadLines, spendShares, type DeparaRow } from "@/lib/m3/depara";
import { adminClient } from "@/lib/supabase/admin";
import { confirmAction, rejectAction, reviewRuleAction, swapAction } from "./actions";

export const metadata = { title: "De-para de insumos · MargoAI" };

const th = "border-b border-border px-4 py-3 font-normal";
const td = "border-b border-border-subtle px-4 py-3";
const small = "min-h-9 cursor-pointer rounded-sm px-3 text-sm";
const field = "min-h-9 rounded-sm border border-border-strong bg-surface px-2 text-sm";

function Actions({ row, code, catalog }: { row: DeparaRow; code: string; catalog: { id: string; name: string }[] }) {
  if (row.state === "auto" || row.state === "person") return <span className="text-sm text-ok">confirmado</span>;
  const hidden = (
    <>
      <input type="hidden" name="conta" value={code} />
      <input type="hidden" name="grupo" value={row.key} />
    </>
  );
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {row.state === "suggested" && (
        <form action={confirmAction} className="flex gap-1.5">
          {hidden}
          {row.needsConversion && <input name="conversao" required aria-label="Unidades do insumo por unidade da nota" placeholder="por unidade" className={`${field} w-24`} />}
          <button type="submit" className={`${small} border-0 bg-ink text-ink-inverse`}>
            Confirmar
          </button>
        </form>
      )}
      <details>
        <summary className={`${small} inline-flex list-none items-center border border-border-strong bg-surface text-ink`}>Trocar</summary>
        <div className="mt-2 flex w-56 flex-col gap-2">
          <form action={swapAction} className="flex flex-col gap-1.5">
            {hidden}
            <select name="insumo" aria-label="Insumo do catálogo" className={field} defaultValue="">
              <option value="">Insumo novo no catálogo</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input name="novo_nome" aria-label="Nome do insumo novo" placeholder="nome do insumo novo" className={field} />
            <div className="flex gap-1.5">
              <input name="novo_categoria" aria-label="Categoria" placeholder="categoria" className={`${field} min-w-0 flex-1`} />
              <select name="novo_unidade" aria-label="Unidade base" className={field} defaultValue="g">
                <option value="g">g</option>
                <option value="ml">ml</option>
                <option value="un">un</option>
              </select>
            </div>
            <input name="conversao" required aria-label="Unidades do insumo por unidade da nota" placeholder={`g, ml ou un por ${row.unit}`} className={field} />
            <button type="submit" className={`${small} border border-border-strong bg-surface text-ink`}>
              Salvar troca
            </button>
          </form>
          {row.state === "suggested" && (
            <form action={rejectAction}>
              {hidden}
              <button type="submit" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-ink underline">
                Recusar sugestão
              </button>
            </form>
          )}
        </div>
      </details>
    </div>
  );
}

export default async function DeparaPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ aviso?: string }> }) {
  await requireConsole("clients");
  const { code } = await params;
  const q = await searchParams;
  const db = adminClient();
  const account = await accountByCode(db, code);
  await requireFlag("m3.depara_ia", account.id);
  const lines = await loadLines(db, account.id);
  const rows = deparaRows(lines);
  const shares = spendShares(lines);
  const catalog = await loadCatalog(db);
  const flagged = flaggedRuleRows(await loadFlaggedRules(db));
  const cards: [number, string][] = [
    [shares.auto, "do gasto casado sem mão (código de barras ou regra)"],
    [shares.ai, "sugerido pela IA, esperando confirmação"],
    [shares.none, "sem par: insumo novo no catálogo"],
  ];

  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C11"
          kicker={`C11 · Módulo 3 · ${account.name}`}
          title="De-para de insumos"
          lead="A descrição da nota vira um insumo do catálogo. A sugestão nunca entra sem um fundador confirmar."
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {account.isSynthetic && <FictitiousLabel />}
          <Link href={`/console/contas/${account.code}/fichas`} className={BUTTON_PRIMARY}>
            Ir para a ficha técnica
          </Link>
        </div>
      </div>

      {q.aviso && (
        <p role="status" className="m-0 rounded-md border border-warn-border bg-warn-bg px-4 py-3 text-md">
          {q.aviso}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {cards.map(([pct, label]) => (
          <section key={label} className="rounded-xl border border-border bg-surface p-4" data-share>
            <div className="font-mono text-3xl">{pct}%</div>
            <div className="text-sm text-ink-muted">{label}</div>
          </section>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[860px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              <th className={th}>Como veio na nota</th>
              <th className={th}>Insumo do catálogo</th>
              <th className={th}>Como casou</th>
              <th className={`${th} text-right`}>Preço</th>
              <th className={th}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-row={r.description} data-state={r.state}>
                <td className={`${td} font-mono text-xs`}>{r.description}</td>
                <td className={`${td} font-semibold`}>{r.ingredient}</td>
                <td className={`${td} text-ink-muted`}>{r.how}</td>
                <td className={`${td} text-right font-mono`}>{r.price}</td>
                <td className={td}>
                  <Actions row={r} code={account.code} catalog={catalog} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {flagged.length > 0 && (
        <section aria-labelledby="regras-em-revisao" className="flex flex-col gap-3">
          <h2 id="regras-em-revisao" className="m-0 text-lg font-bold">
            Regras gerais em revisão
          </h2>
          <p className="m-0 text-md text-ink-muted">
            Em alguma conta, uma pessoa escolheu outro insumo para uma nota que a regra geral casava. Até um fundador revisar, a regra só sugere e não confirma sozinha.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[720px] border-collapse text-md">
              <thead>
                <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                  <th className={th}>Regra</th>
                  <th className={th}>Insumo da regra</th>
                  <th className={th}>Escolhido na conta</th>
                  <th className={th}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((r) => (
                  <tr key={r.id} data-rule={r.rule}>
                    <td className={`${td} font-mono text-xs`}>{r.rule}</td>
                    <td className={`${td} font-semibold`}>{r.ingredient}</td>
                    <td className={td}>{r.chosen}</td>
                    <td className={td}>
                      <form action={reviewRuleAction}>
                        <input type="hidden" name="conta" value={account.code} />
                        <input type="hidden" name="regra" value={r.id} />
                        <button type="submit" className={`${small} border border-border-strong bg-surface text-ink`}>
                          Revisada
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </ConsoleMain>
  );
}
