// C21 Alertas (design/C21-Alertas.dc.html, 05 §A, 04 §10). Fundador and Operação: open alerts until resolved.
import Link from "next/link";
import { ConsoleMain, FictitiousLabel, PageTitle } from "@/components/console";
import { loadOpenAlerts } from "@/lib/console/alerts";
import { loadManualQueue } from "@/lib/notify/manual-queue";
import { requireConsole } from "@/lib/console/staff";
import { alertConfigFromEnv } from "@/lib/notify/alerts";
import type { AlertSeverity } from "@/lib/notify/store";
import { adminClient } from "@/lib/supabase/admin";
import { markWhatsAppSentAction, resolveAlertAction } from "./actions";

export const metadata = { title: "Alertas · MargoAI" };

const th = "border-b border-border px-3.5 py-3";
const td = "border-b border-border-subtle px-3.5 py-2.75";
const BADGE: Record<AlertSeverity, string> = { urgente: "bg-danger-bg", medio: "bg-warn-bg", baixo: "bg-sunken" };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  await requireConsole("clients");
  const { aviso } = await searchParams;
  const now = new Date();
  const { rows, synthetic } = await loadOpenAlerts(adminClient(), now);
  const whatsapp = await loadManualQueue(adminClient(), now);
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
        <Link href="/console/emails/deadline_soon">Ver e-mail que o dono recebe</Link>
      </div>
      {/* 06 §7, D36: the manual WhatsApp queue. Not drawn: 05 does not say where it lives, so it is a section
          of C21 (decision listed for Marlon). Quiet hours hold owner messages (E05). */}
      <section aria-labelledby="whatsapp-queue" className="flex flex-col gap-3">
        <h2 id="whatsapp-queue" className="m-0 text-xl font-bold">
          WhatsApp para mandar
        </h2>
        <p className="m-0 text-md text-ink-muted">
          Até o WhatsApp Business, quem está de plantão manda cada mensagem pelo link e marca como enviada. Das 22h às 8h as mensagens para o dono esperam.
        </p>
        {aviso && (
          <p role="status" className="m-0 rounded-md bg-warn-bg px-3 py-2 text-md">
            {aviso}
          </p>
        )}
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-md">
            <thead>
              <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                <th className={th}>Para</th>
                <th className={th}>Cliente</th>
                <th className={th}>Aviso</th>
                <th className={th}>Mensagem</th>
                <th className={th}>Desde</th>
                <th className={th}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {whatsapp.length === 0 && (
                <tr>
                  <td colSpan={6} className={`${td} text-ink-muted`}>
                    Nenhuma mensagem para mandar.
                  </td>
                </tr>
              )}
              {whatsapp.map((w) => (
                <tr key={w.id} data-whatsapp={w.id}>
                  <td className={td}>{w.to}</td>
                  <td className={td}>{w.client}</td>
                  <td className={td}>{w.notice}</td>
                  <td className={`${td} max-w-[360px] text-sm`}>{w.text}</td>
                  <td className={`${td} font-mono text-xs`}>{w.since}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {w.state === "held" && <span className="text-sm text-ink-muted">espera até 8h</span>}
                    {w.state === "no_number" && <span className="text-sm text-ink-muted">sem WhatsApp</span>}
                    {w.state === "ready" && (
                      <form action={markWhatsAppSentAction} className="flex items-center gap-3">
                        {w.link && (
                          <a href={w.link} target="_blank" rel="noreferrer" className="text-sm">
                            abrir no WhatsApp
                          </a>
                        )}
                        <input type="hidden" name="notification" value={w.id} />
                        <button
                          type="submit"
                          aria-label={`marcar enviada: ${w.to}`}
                          className="min-h-8 cursor-pointer rounded-sm border border-border-strong bg-surface px-2 text-sm text-ink"
                        >
                          marcar enviada
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </ConsoleMain>
  );
}
