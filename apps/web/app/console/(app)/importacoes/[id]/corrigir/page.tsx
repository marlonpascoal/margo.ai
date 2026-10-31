// C17 Corrigir importação (design/C17-CorrigirImport.dc.html, 05 §A, 04 §11). Fundador and Operação, behind
// the run's file flag. Copy verbatim from the drawing; "(novo)" marks a column no saved layout knows.
import { notFound } from "next/navigation";
import { BUTTON_PRIMARY, ConsoleMain, FictitiousLabel, PageTitle, Pill } from "@/components/console";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { FILE_FLAG } from "@/lib/m2/account";
import { CHANNEL_LABEL, count } from "@/lib/m2/format";
import { checkLine, columnStatus, FIELDS, IGNORE, loadCorrection } from "@/lib/m2/mapping";
import { adminClient } from "@/lib/supabase/admin";
import { saveMappingAction } from "./actions";

export const metadata = { title: "Corrigir importação · MargoAI" };

const th = "border-b border-border px-3.5 py-3 font-normal";
const td = "border-b border-border-subtle px-3.5 py-2.5";

export default async function CorrectImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string }> }) {
  await requireConsole("clients");
  const { id } = await params;
  const { aviso } = await searchParams;
  const db = adminClient();
  const run = await loadCorrection(db, id);
  if (!run || !run.log) notFound();
  const flag = FILE_FLAG[run.channel];
  if (!flag) notFound();
  await requireFlag(flag, run.accountId);
  const { data: account } = await db.from("account").select("name, is_synthetic").eq("id", run.accountId).single();
  const log = run.log;
  const check = checkLine(log);
  const waiting = run.status === "needs_mapping";
  const app = CHANNEL_LABEL[run.channel];

  return (
    <ConsoleMain>
      <form action={saveMappingAction} className="flex flex-col gap-6">
        <input type="hidden" name="run" value={run.id} />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageTitle
            code="C17"
            kicker={`C17 · Módulo 2 · ${account?.name ?? ""} · ${run.fileName}`}
            title="Corrigir importação"
            lead={`O arquivo da ${app} mudou de formato. Diga o que cada coluna nova significa; a regra fica salva para os próximos arquivos.`}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            {account?.is_synthetic && <FictitiousLabel />}
            <button type="submit" disabled={!waiting || !check.ok} className={`${BUTTON_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50`}>
              Salvar e reprocessar
            </button>
          </div>
        </div>
        {aviso && (
          <p role="status" className="m-0 rounded-md border border-warn-border bg-warn-bg px-4 py-3 text-md">
            {aviso}
          </p>
        )}
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[760px] border-collapse text-md">
            <thead>
              <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                <th className={th}>Coluna no arquivo</th>
                <th className={th}>Exemplo</th>
                <th className={th}>Vira o campo</th>
                <th className={th}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {log.columns.map((c, i) => (
                <tr key={c.name} data-column={c.name}>
                  <td className={`${td} text-sm`}>
                    {c.name}
                    {!c.known && " (novo)"}
                  </td>
                  <td className={`${td} font-mono text-sm`}>{c.example}</td>
                  <td className={td}>
                    <select
                      name={`col-${i}`}
                      aria-label={`Vira o campo: ${c.name}`}
                      defaultValue={c.field ?? (c.known ? IGNORE : "")}
                      disabled={!waiting}
                      className="min-h-9 rounded-sm border border-border-strong bg-surface px-2 text-sm"
                    >
                      {!c.known && (
                        <option value="" disabled>
                          escolher
                        </option>
                      )}
                      {Object.entries(FIELDS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                      <option value={IGNORE}>{IGNORE}</option>
                    </select>
                  </td>
                  <td className={td}>
                    <Pill tone={c.known ? "ok" : "warn"}>{columnStatus(c)}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-6 rounded-xl border border-border bg-surface p-4 text-md" data-check={check.ok ? "bate" : "nao-bate"}>
          <span>
            Linhas no arquivo: <b className="font-mono">{count(log.rows_in_file)}</b>
          </span>
          <span>
            Soma do repasse no arquivo: <b className="font-mono">{check.file}</b>
          </span>
          <span>
            Soma depois do mapeamento: <b className={`font-mono ${check.ok ? "text-ok" : "text-danger"}`}>{check.mapped}</b>
          </span>
        </div>
        {!waiting && <p className="m-0 text-sm text-ink-muted">Esta importação já foi reprocessada.</p>}
      </form>
    </ConsoleMain>
  );
}
