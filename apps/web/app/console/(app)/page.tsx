// C01 Clientes (design/C01-Clientes.dc.html, 05 §A). Fundador and Operação.
import Link from "next/link";
import { ConsoleMain, FictitiousLabel, PageTitle } from "@/components/console";
import { loadClients, type Kpi } from "@/lib/console/clients";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Clientes · MargoAI" };

function KpiCard({ kpi, unit = "", label }: { kpi: Kpi; unit?: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4" data-stubbed={kpi.stubbed ? "true" : undefined}>
      <div className="font-mono text-3xl">
        {kpi.value}
        {unit}
      </div>
      <div className="text-sm text-ink-muted">{label}</div>
    </div>
  );
}

const th = "border-b border-border px-4 py-3";
const td = "border-b border-border-subtle px-4 py-3.5";

export default async function ClientsPage() {
  await requireConsole("clients");
  const { kpis, rows, synthetic } = await loadClients(adminClient());
  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle code="C01" title="Clientes" />
        <div className="flex flex-wrap items-center gap-2.5">
          {synthetic && <FictitiousLabel />}
          <Link
            href="/console/raio-x/novo"
            className="inline-flex min-h-11 items-center rounded-md bg-ink px-4.5 text-base font-semibold text-ink-inverse no-underline hover:text-ink-inverse"
          >
            Novo raio-X
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard kpi={kpis.funnel} label="restaurantes no funil" />
        <KpiCard kpi={kpis.xraysDelivered} label="raio-X entregues" />
        <KpiCard kpi={kpis.ifoodConnected} label="com iFood conectado" />
        <KpiCard kpi={kpis.hoursThisMonth} unit=" h" label="horas registradas no mês" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              <th className={th}>Restaurante</th>
              <th className={th}>Módulo 1 · raio-X</th>
              <th className={th}>Módulo 2 · canais</th>
              <th className={th}>Módulo 3 · custo</th>
              <th className={th}>Próximo passo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td className={td}>
                  <Link href={r.href} className="font-semibold">
                    {r.name}
                  </Link>
                  {r.detail && <div className="text-xs text-ink-muted">{r.detail}</div>}
                </td>
                <td className={td}>{r.m1.label}</td>
                <td className={td}>{r.m2.label}</td>
                <td className={td}>{r.m3.label}</td>
                <td className={`${td} text-ink-muted`}>{r.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ConsoleMain>
  );
}
