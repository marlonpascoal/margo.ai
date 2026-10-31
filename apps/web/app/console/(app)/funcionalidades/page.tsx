// C20 Funcionalidades (design/C20-Funcionalidades.dc.html, 05 §A, 04 §6). Fundador only; others get 404.
import { ConsoleMain, PageTitle } from "@/components/console";
import { ENV_OPTIONS, loadFeatures, onOff, parseEnv, PLAN_LABEL, PLANS } from "@/lib/console/features";
import { requireConsole } from "@/lib/console/staff";
import { flagEnv } from "@/lib/flags/keys";
import { adminClient } from "@/lib/supabase/admin";
import { removeExceptionAction, toggleDefaultAction } from "./actions";
import EnvSwitch from "./EnvSwitch";
import ExceptionForm from "./ExceptionForm";

export const metadata = { title: "Funcionalidades · MargoAI" };

const th = "border-b border-border px-3 py-2.5";
const td = "border-b border-border-subtle px-3 py-2 align-top";

export default async function FeaturesPage({ searchParams }: { searchParams: Promise<{ amb?: string | string[] }> }) {
  await requireConsole("flags");
  const env = parseEnv((await searchParams).amb, flagEnv());
  const { rows, accounts } = await loadFeatures(adminClient(), env);
  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C20"
          title="Funcionalidades"
          who="só papel Fundador"
          lead="Toda funcionalidade do produto tem uma chave. O plano define o padrão; uma conta pode ter exceção. Toda mudança fica no histórico."
        />
        <EnvSwitch env={env} options={ENV_OPTIONS} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="text-2xs tracking-[0.04em] text-ink-muted uppercase">
              <th className={`${th} text-left`}>Chave</th>
              <th className={`${th} text-left`}>O que liga</th>
              {PLANS.map((p) => (
                <th key={p} className={th}>
                  {PLAN_LABEL[p]}
                </th>
              ))}
              <th className={`${th} text-left`}>Exceções</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-flag={r.key} className="text-center">
                <td className={`${td} text-left font-mono text-xs`}>{r.key}</td>
                <td className={`${td} text-left`}>{r.description}</td>
                {PLANS.map((p) => {
                  const on = r.defaults[p];
                  return (
                    <td key={p} className={td}>
                      <form action={toggleDefaultAction}>
                        <input type="hidden" name="key" value={r.key} />
                        <input type="hidden" name="env" value={env} />
                        <input type="hidden" name="plan" value={p} />
                        <input type="hidden" name="value" value={String(!on)} />
                        <button
                          type="submit"
                          aria-label={`${r.key} ${PLAN_LABEL[p]}: ${onOff(on)}`}
                          aria-pressed={on}
                          className={`min-h-8 cursor-pointer rounded-sm px-1.5 underline decoration-dotted underline-offset-4 ${on ? "text-ok" : "text-ink-muted"}`}
                        >
                          {onOff(on)}
                        </button>
                      </form>
                    </td>
                  );
                })}
                <td className={`${td} min-w-[220px] text-left text-xs text-ink-muted`}>
                  <div className="flex flex-col gap-1">
                    {r.exceptions.map((x) => (
                      <form key={x.accountId} action={removeExceptionAction} className="flex flex-wrap items-baseline gap-2" data-exception={x.accountCode}>
                        <input type="hidden" name="key" value={r.key} />
                        <input type="hidden" name="env" value={env} />
                        <input type="hidden" name="account" value={x.accountId} />
                        <span>{x.text}</span>
                        <button type="submit" aria-label={`remover exceção ${x.accountCode} de ${r.key}`} className="cursor-pointer text-ink underline">
                          remover
                        </button>
                      </form>
                    ))}
                    <ExceptionForm flagKey={r.key} env={env} accounts={accounts} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-sm leading-normal text-ink-muted">
        Desligada em todos os planos = ainda não lançada. As telas L01 e L02 só aparecem quando a chave delas liga, depois de 15/fev.
      </div>
    </ConsoleMain>
  );
}
