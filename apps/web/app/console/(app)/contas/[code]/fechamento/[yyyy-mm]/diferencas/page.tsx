// C09 Diferenças no repasse (design/C09-Diferencas.dc.html, 05 §A, DIF-01 to DIF-05). Fundador and Operação,
// behind m2.contestacao. Each row links to the orders that produced it (the order sheet).
import Link from "next/link";
import { notFound } from "next/navigation";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ConsoleMain, FictitiousLabel, PageTitle, Pill } from "@/components/console";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode } from "@/lib/m2/account";
import { closePeriods, CONFIDENCE_LABEL, contestationLabel, loadClose, loadDifferences, summarize } from "@/lib/m2/close";
import { brl, CHANNEL_LABEL, monthShort, parseMonth, percent } from "@/lib/m2/format";
import { adminClient } from "@/lib/supabase/admin";
import { generateCloseAction } from "./actions";

export const metadata = { title: "Diferenças no repasse · MargoAI" };

const th = "border-b border-border px-4 py-3 font-normal";
const td = "border-b border-border-subtle px-4 py-3";
const CONF_TONE = { certa: "ok", provavel: "warn", duvidosa: "run" } as const;

export default async function DifferencesPage({ params, searchParams }: { params: Promise<{ code: string; "yyyy-mm": string }>; searchParams: Promise<{ gerado?: string }> }) {
  await requireConsole("clients");
  const p = await params;
  const { gerado } = await searchParams;
  const month = parseMonth(p["yyyy-mm"]);
  if (!month) notFound();
  const db = adminClient();
  const account = await accountByCode(db, p.code);
  await requireFlag("m2.contestacao", account.id);
  const close = (await closePeriods(db, account.id)).find((c) => c.month === month);
  if (!close) notFound();
  const [diffs, { lines }] = await Promise.all([loadDifferences(db, close.id), loadClose(db, close.id)]);
  const s = summarize(diffs);
  const gross = lines.reduce((a, l) => a + l.gross, 0);
  const today = new Date().toISOString().slice(0, 10);
  const contestations = `/console/contas/${account.code}/contestacoes`;

  return (
    <ConsoleMain>
      <form method="get" action={contestations} className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageTitle
            code="C09"
            kicker={`C09 · Módulo 2 · ${account.name} · ${monthShort(month)}`}
            title="Diferenças no repasse"
            lead="O que o app deveria ter repassado, pedido a pedido, contra o que repassou. Cada diferença tem a regra que a encontrou."
          />
          <div className="flex flex-wrap items-center gap-2.5">
            {account.isSynthetic && <FictitiousLabel />}
            <button type="submit" className={BUTTON_SECONDARY}>
              Preparar contestação
            </button>
            <button type="submit" formAction={generateCloseAction} className={BUTTON_PRIMARY}>
              Gerar fechamento mensal
            </button>
            <input type="hidden" name="conta" value={account.code} />
            <input type="hidden" name="mes" value={p["yyyy-mm"]} />
          </div>
        </div>
        {(gerado || close.status !== "open") && (
          <p role="status" className="m-0 rounded-md border border-ok-border bg-ok-bg px-4 py-3 text-md">
            Fechamento gerado{close.pdfPath ? "" : ": o PDF está na fila"}.{gerado === "avisado" ? " O dono foi avisado." : ""}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
            <div className="font-mono text-3xl">{brl(s.certain.total)}</div>
            <div className="text-sm text-ink-muted">certas ({s.certain.count}), prontas para contestar</div>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
            <div className="font-mono text-3xl">{brl(s.probable.total)}</div>
            <div className="text-sm text-ink-muted">prováveis ({s.probable.count}), conferir com o dono</div>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
            <div className="font-mono text-3xl">{percent(s.certain.total, gross)}</div>
            <div className="text-sm text-ink-muted">do bruto de delivery no mês</div>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[820px] border-collapse text-md">
            <thead>
              <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                <th className={th}>
                  <span className="sr-only">Escolher</span>
                </th>
                {["Regra", "O que aconteceu", "Canal", "Pedidos", "Valor", "Confiança", "Contestação"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => (
                <tr key={d.id} data-difference={d.rule_id}>
                  <td className={td}>
                    <input type="checkbox" name="d" value={d.id} aria-label={`Escolher ${d.rule_id}: ${d.description}`} />
                  </td>
                  <td className={`${td} font-mono text-xs`}>{d.rule_id}</td>
                  <td className={td}>{d.description}</td>
                  <td className={td}>{CHANNEL_LABEL[d.channel]}</td>
                  <td className={`${td} font-mono`}>
                    <Link href={`/console/contas/${account.code}/diferencas/${d.id}/pedidos`} title="Baixar os pedidos" prefetch={false}>
                      {d.orders_count}
                    </Link>
                  </td>
                  <td className={`${td} font-mono whitespace-nowrap`}>{brl(d.amount_cents)}</td>
                  <td className={td}>
                    <Pill tone={CONF_TONE[d.confidence]}>{CONFIDENCE_LABEL[d.confidence]}</Pill>
                  </td>
                  <td className={`${td} text-sm`}>{contestationLabel(d, today)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
    </ConsoleMain>
  );
}
