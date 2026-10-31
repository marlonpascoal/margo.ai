// C08 Fechamento por loja e canal (design/C08-Fechamento.dc.html, 05 §A). Fundador and Operação.
// REP-01 to REP-05 give the expected values, ledger_entry the actual ones (worker-import writes close_line);
// the payout column equals the payout entries of the month (C08 "Done when"). The M3 prompt links to C10
// until the close has contribution.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleMain, FictitiousLabel, PageTitle } from "@/components/console";
import NavSelect from "@/components/NavSelect";
import { isEnabled } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode, requireAnyFlag } from "@/lib/m2/account";
import {
  bannerParts,
  closePeriods,
  closeRows,
  loadClose,
  loadDifferences,
  monthOptions,
  summarize,
} from "@/lib/m2/close";
import { monthLong, parseMonth, plural } from "@/lib/m2/format";
import { adminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Fechamento · MargoAI" };

const th = "border-b border-border px-4 py-3 font-normal";
const td = "border-b border-border-subtle px-4 py-3.5";
const HEAD = [
  "Canal",
  "Venda bruta",
  "Comissão",
  "Pagamento",
  "Entrega",
  "Promoção",
  "Antecipação",
  "Repasse",
  "% do bruto",
];

export default async function ClosePage({
  params,
}: {
  params: Promise<{ code: string; "yyyy-mm": string }>;
}) {
  await requireConsole("clients");
  const p = await params;
  const month = parseMonth(p["yyyy-mm"]);
  if (!month) notFound();
  const db = adminClient();
  const account = await accountByCode(db, p.code);
  await requireAnyFlag(
    ["m2.arquivo_ifood", "m2.arquivo_99food", "m2.ifood_api"],
    account.id,
  );
  const periods = await closePeriods(db, account.id);
  const close = periods.find((c) => c.month === month);
  const { lines, stores } = close
    ? await loadClose(db, close.id)
    : { lines: [], stores: 0 };
  const rows = closeRows(lines);
  const contest = await isEnabled("m2.contestacao", account.id);
  const summary =
    close && contest ? summarize(await loadDifferences(db, close.id)) : null;
  const base = `/console/contas/${account.code}/fechamento`;
  const options = monthOptions(periods).map((o) => ({
    ...o,
    href: `${base}/${o.value}`,
  }));
  if (!options.some((o) => o.value === p["yyyy-mm"]))
    options.unshift({
      value: p["yyyy-mm"],
      label: p["yyyy-mm"],
      href: `${base}/${p["yyyy-mm"]}`,
    });
  const banner = summary && summary.count > 0 ? bannerParts(summary) : null;
  // The M3 prompt shows while the close has no contribution (CTB-01) yet.
  const { count: costRows } = close
    ? await db
        .from("contribution")
        .select("id", { count: "exact", head: true })
        .eq("close_period_id", close.id)
    : { count: 0 };

  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C08"
          kicker={`C08 · Módulo 2 · ${account.name} · ${plural(stores, "loja", "lojas")}`}
          title={`Fechamento de ${monthLong(month)}, por canal`}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {account.isSynthetic && <FictitiousLabel />}
          <span className="text-sm text-ink-muted">Mês</span>
          <NavSelect
            label="Mês"
            value={p["yyyy-mm"]}
            options={options}
            className="min-h-11 rounded-md text-base"
          />
        </div>
      </div>
      {banner && (
        <Link
          href={`${base}/${p["yyyy-mm"]}/diferencas`}
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-danger-border bg-danger-bg px-5 py-4 text-ink no-underline"
          data-banner
        >
          <span className="text-base">
            <b>{banner[0]}</b>
            {banner[1]} <b>{banner[2]}</b>
            {banner[3]}
          </span>
          <span className="underline">Ver diferenças</span>
        </Link>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[820px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              {HEAD.map((h, i) => (
                <th key={h} className={`${th} ${i > 0 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={HEAD.length} className={`${td} text-ink-muted`}>
                  Nenhuma importação neste mês.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.channel}
                data-channel={r.channel}
                className={r.total ? "font-bold" : ""}
              >
                <td className={td}>{r.channel}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className={`${td} text-right font-mono`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(costRows ?? 0) === 0 && (
        <div className="flex flex-wrap items-center gap-3 text-md">
          <span>
            Ainda falta o custo dos insumos para chegar ao lucro por item.
          </span>
          <Link href={`/console/contas/${account.code}/notas`}>
            Ir para o módulo 3
          </Link>
        </div>
      )}
    </ConsoleMain>
  );
}
