// C15 Assinaturas (design/C15-Assinaturas.dc.html, 05 C15, 04 §7, D27, D37, D40). Fundador only; others 404.
import { ConsoleMain, PageTitle, Pill } from "@/components/console";
import { asaasConfigFromEnv } from "@/lib/billing/asaas";
import { money, loadC15View } from "@/lib/billing/view";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import { NewPilot, PilotForm, PlanForm } from "./Forms";

export const metadata = { title: "Assinaturas · MargoAI" };
export const dynamic = "force-dynamic";

const th = "border-b border-border px-3.5 py-3";
const td = "border-b border-border-subtle px-3.5 py-3";
const TONE = { ok: "ok", warn: "warn", muted: "run", danger: "danger" } as const;

function Kpi({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="font-mono text-[26px]">{value}</div>
      <div className="text-sm text-ink-muted">{label}</div>
    </div>
  );
}

export default async function SubscriptionsPage() {
  await requireConsole("billing");
  const v = await loadC15View(adminClient(), asaasConfigFromEnv(), new Date());
  const unitActive = v.unit === "loja" ? "loja ativa" : "cozinha ativa";
  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C15"
          kicker="C15 · Clientes e cobrança"
          title="Assinaturas"
          lead={`Uma assinatura por conta (grupo), cobrada por ${unitActive}. O status vem dos webhooks do Asaas.`}
        />
        {v.labels.length > 0 && (
          <span className="rounded-xs border border-dashed border-ink-faint px-2 py-0.5 font-mono text-xs text-ink-muted">{v.labels.join(" · ")}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi value={v.kpis.trial} label={`em teste grátis (${v.kpis.trialDays} dias)`} />
        <Kpi value={v.kpis.paying} label="pagante" />
        <Kpi value={v.kpis.revenue} label="receita mensal" />
        <Kpi value={v.kpis.pastDue} label="com pagamento atrasado" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[860px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              <th className={th}>Conta</th>
              <th className={th}>Plano</th>
              <th className={th}>{v.unit === "loja" ? "Lojas ativas" : "Cozinhas ativas"}</th>
              <th className={th}>Situação</th>
              <th className={th}>Próxima cobrança</th>
              <th className={th}>Asaas</th>
              <th className={th}>Último evento</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.accountId}>
                <td className={`${td} font-semibold whitespace-nowrap`}>{r.account}</td>
                <td className={td}>{r.plan}</td>
                <td className={`${td} font-mono`}>{r.units}</td>
                <td className={td}>
                  <Pill tone={TONE[r.tone]}>{r.status}</Pill>
                </td>
                <td className={`${td} font-mono whitespace-nowrap`}>{r.next}</td>
                <td className={`${td} font-mono text-xs whitespace-nowrap text-ink-muted`}>{r.asaas}</td>
                <td className={`${td} text-sm text-ink-muted`}>{r.lastEvent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-label="Pilotos pagos" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <b>Pilotos pagos (fora dos planos, até 15/fev)</b>
          <NewPilot accounts={v.accounts} fixedHint={v.fixedHint} />
        </div>
        {v.pilots.map((p) => (
          <PilotForm key={p.id} pilot={p} accounts={v.accounts} fixedHint={v.fixedHint} />
        ))}
        <div className="text-xs leading-normal text-ink-muted">
          Meses 1 e 2: cobrança avulsa no Asaas, calculada pelo que foi creditado (C16). Dia 61: vira assinatura mensal fixa, sem desconto de última hora (teste E6 do plano de
          experimentos).
        </div>
      </section>
      <div className="text-sm leading-normal text-ink-muted">
        Fim do teste: a conta recebe aviso no WhatsApp 3 dias antes e no dia. Sem plano escolhido, volta para o Raio-X grátis e os dados de canal param de atualizar.
      </div>
      <section aria-label="Planos" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <b>Planos</b>
        {v.plans.map((p) => (
          <PlanForm
            key={p.id}
            plan={{
              id: p.id,
              name: p.name,
              price: p.priceCents === null ? "" : money(p.priceCents).replace(/^R\$ /, ""),
              unit: p.billingUnit,
              trialDays: p.trialDays,
              example: p.priceIsExample,
            }}
          />
        ))}
      </section>
    </ConsoleMain>
  );
}
