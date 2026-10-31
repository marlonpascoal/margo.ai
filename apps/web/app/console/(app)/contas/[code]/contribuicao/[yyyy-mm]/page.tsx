// C13 Contribuição por item e canal (design/C13-Contribuicao.dc.html, 05 §A). Fundador and Operação; no flag
// applies to the screen (04 §6). Rows are worker-cost's: CTB-01 per order, CTB-02 "can invert" flag, DLV-01
// decision. "Gerar fechamento mensal" works as in C09 (m2.contestacao); "Aprovação de cupom (depois)" stays
// disabled unless l.aprovacao_cupom.
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  ConsoleMain,
  FictitiousLabel,
  PageTitle,
} from "@/components/console";
import { isEnabled } from "@/lib/flags";
import { accountByCode } from "@/lib/m2/account";
import { closePeriods } from "@/lib/m2/close";
import { monthShort, parseMonth } from "@/lib/m2/format";
import { loadContribution, loadDecision } from "@/lib/m3/data";
import { c13Cells, decisionC13, errorNote } from "@/lib/m3/format";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { generateCloseFromC13Action } from "./actions";

export const metadata = { title: "Contribuição · MargoAI" };

const th = "border-b border-border px-4 py-3 font-normal";
const td = "border-b border-border-subtle px-4 py-3";
const HEAD = [
  "Item",
  "Canal",
  "Preço",
  "Canal leva",
  "Insumos",
  "Sobra",
  "% do preço",
];

export default async function ContributionPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; "yyyy-mm": string }>;
  searchParams: Promise<{ gerado?: string }>;
}) {
  await requireConsole("clients");
  const [p, sp] = await Promise.all([params, searchParams]);
  const month = parseMonth(p["yyyy-mm"]);
  if (!month) notFound();
  const db = adminClient();
  const account = await accountByCode(db, p.code);
  const close = (await closePeriods(db, account.id)).find(
    (c) => c.month === month,
  );
  const [rows, decision, contest, coupon] = await Promise.all([
    close ? loadContribution(db, close.id) : Promise.resolve([]),
    close ? loadDecision(db, close.id, month) : Promise.resolve(null),
    isEnabled("m2.contestacao", account.id),
    isEnabled("l.aprovacao_cupom", account.id),
  ]);
  const sentence = decision ? decisionC13(decision) : null;

  return (
    <ConsoleMain>
      <form
        action={generateCloseFromC13Action}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <PageTitle
          code="C13"
          kicker={`C13 · Módulo 3 · ${account.name} · ${monthShort(month)}`}
          title="Contribuição por item e canal"
          lead="Preço, menos o que o canal leva, menos o custo dos insumos. O que sobra por pedido."
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {account.isSynthetic && <FictitiousLabel />}
          {coupon ? (
            <span className={BUTTON_SECONDARY}>
              Aprovação de cupom (depois)
            </span>
          ) : (
            <span
              aria-disabled="true"
              className={`${BUTTON_SECONDARY} cursor-not-allowed text-ink-faint`}
            >
              Aprovação de cupom (depois)
            </span>
          )}
          {contest && close && (
            <button type="submit" className={BUTTON_PRIMARY}>
              Gerar fechamento mensal
            </button>
          )}
          <input type="hidden" name="conta" value={account.code} />
          <input type="hidden" name="mes" value={p["yyyy-mm"]} />
        </div>
      </form>
      {close && (sp.gerado || close.status !== "open") && (
        <p
          role="status"
          className="m-0 rounded-md border border-ok-border bg-ok-bg px-4 py-3 text-md"
        >
          Fechamento gerado{close.pdfPath ? "" : ": o PDF está na fila"}.
          {sp.gerado === "avisado" ? " O dono foi avisado." : ""}
        </p>
      )}
      {sentence && (
        <div
          className="rounded-xl border border-danger-border bg-danger-bg px-5 py-4 text-base leading-normal"
          data-decision
        >
          {sentence.map((part, i) =>
            i % 2 === 1 ? (
              <b key={i} className={part.startsWith("R$") ? "font-mono" : ""}>
                {part}
              </b>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[820px] border-collapse text-md">
          <thead>
            <tr className="text-right text-xs tracking-[0.04em] text-ink-muted uppercase">
              {HEAD.map((h, i) => (
                <th key={h} className={`${th} ${i < 2 ? "text-left" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-right font-mono">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={HEAD.length}
                  className={`${td} text-left font-sans text-ink-muted`}
                >
                  Ainda sem contribuição neste mês: ela aparece quando as fichas
                  técnicas estiverem prontas.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const c = c13Cells(r);
              return (
                <tr
                  key={`${r.menuItemId}:${r.channel}:${r.campaignName ?? ""}`}
                  data-row={`${c[0]} · ${c[1]}`}
                  data-invert={r.canInvert ? "1" : undefined}
                >
                  <td className={`${td} text-left font-sans font-semibold`}>
                    {c[0]}
                    {r.canInvert && (
                      <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-xs font-normal">
                        pode inverter
                      </span>
                    )}
                  </td>
                  <td className={`${td} text-left font-sans`}>{c[1]}</td>
                  <td className={td}>{c[2]}</td>
                  <td className={`${td} text-danger`}>{c[3]}</td>
                  <td className={`${td} text-danger`}>{c[4]}</td>
                  <td
                    className={`${td} font-semibold ${r.leftCents < 0 ? "text-danger" : "text-ok"}`}
                  >
                    {c[5]}
                  </td>
                  <td className={td}>{c[6]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div className="text-sm text-ink-muted">
          {(() => {
            const note = errorNote(rows);
            const [before, after] = note.split("ver ficha técnica");
            return (
              <>
                {before}
                <Link href={`/console/contas/${account.code}/fichas`}>
                  ver ficha técnica
                </Link>
                {after}
              </>
            );
          })()}
        </div>
      )}
    </ConsoleMain>
  );
}
