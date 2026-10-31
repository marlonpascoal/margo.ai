// C21 Alertas (design/C21-Alertas.dc.html, 05 §A, 04 §10). Fundador and Operação: open alerts until resolved.
import Link from "next/link";
import { ConsoleMain, FictitiousLabel, PageTitle } from "@/components/console";
import { loadOpenAlerts } from "@/lib/console/alerts";
import { requireConsole } from "@/lib/console/staff";
import { alertConfigFromEnv } from "@/lib/notify/alerts";
import type { AlertSeverity } from "@/lib/notify/store";
import { adminClient } from "@/lib/supabase/admin";
import { resolveAlertAction } from "./actions";

export const metadata = { title: "Alertas · MargoAI" };

const th = "border-b border-border px-3.5 py-3";
const td = "border-b border-border-subtle px-3.5 py-2.75";
const BADGE: Record<AlertSeverity, string> = { urgente: "bg-danger-bg", medio: "bg-warn-bg", baixo: "bg-sunken" };

export default async function AlertsPage() {
  await requireConsole("clients");
  const { rows, synthetic } = await loadOpenAlerts(adminClient(), new Date());
  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C21"
          title="Alertas"
          who="Operação"
          lead="O que precisa de alguém da equipe. Cada alerta vai por e-mail para a equipe e fica aqui até alguém resolver."
        />
        {synthetic && <FictitiousLabel />}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[900px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              <th className={th}>Gravidade</th>
              <th className={th}>Alerta</th>
              <th className={th}>Cliente</th>
              <th className={th}>Desde</th>
              <th className={th}>Avisado por</th>
              <th className={th}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className={`${td} text-ink-muted`}>
                  Nenhum alerta aberto.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} data-alert={r.id}>
                <td className={td}>
                  <span className={`rounded-full px-2.5 py-0.75 text-xs ${BADGE[r.severity]}`}>{r.severityLabel}</span>
                </td>
                <td className={td}>{r.title}</td>
                <td className={td}>{r.client}</td>
                <td className={`${td} font-mono text-xs`}>{r.since}</td>
                <td className={`${td} text-sm text-ink-muted`}>{r.via}</td>
                <td className={`${td} whitespace-nowrap`}>
                  <form action={resolveAlertAction} className="flex items-center gap-3">
                    {r.action && (
                      <Link href={r.action.href} className="text-sm">
                        {r.action.label}
                      </Link>
                    )}
                    <input type="hidden" name="alert" value={r.id} />
                    <button
                      type="submit"
                      aria-label={`resolver: ${r.title}`}
                      className="min-h-8 cursor-pointer rounded-sm border border-border-strong bg-surface px-2 text-sm text-ink"
                    >
                      resolver
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-6 rounded-xl border border-border bg-surface p-4 text-md">
        <span>
          <b>Para a equipe:</b> e-mail para {alertConfigFromEnv().teamEmail}; urgentes também no WhatsApp do fundador de plantão.
        </span>
        <span>
          <b>Para o dono:</b> segue as preferências de cada pessoa (W08).
        </span>
        {/* E02 is an e-mail template with no route yet (05 §C); the link opens it once the notifier renders it. */}
        <span aria-disabled="true" className="text-ink-faint underline">
          Ver e-mail que o dono recebe
        </span>
      </div>
    </ConsoleMain>
  );
}
