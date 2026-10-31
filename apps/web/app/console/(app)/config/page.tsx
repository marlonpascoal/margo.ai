// C14 Configurações (design/C14-Config.dc.html, 05 §A). Fundador only; Operação gets 404.
// Secrets show where they live and whether they are set, never a value (02 §6, A06).
import { Card, ConsoleMain, PageTitle } from "@/components/console";
import { loadSettings, RETENTION_DAYS, XRAY_DEFAULTS, type AuthState, type SecretState } from "@/lib/console/settings";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Configurações · MargoAI" };

const row = "grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-border-subtle py-2.5 text-md";
const hint = "text-sm text-ink-muted";
const field = "box-border min-h-10 rounded-sm border border-border-strong bg-surface px-2.5 text-ink";

const AUTH_COLOR: Record<AuthState, string> = { signed: "text-ok", not_needed: "text-ink-muted" };
const SECRET_COLOR: Record<SecretState, string> = { set: "text-ok", missing: "text-warn", elsewhere: "text-ink-muted", not_kept: "text-warn" };

/** "Vercel e Maritime" when set; "falta: ..." when this app's environment does not have it. */
const secretText = (where: string, state: SecretState) => (state === "missing" ? `falta: ${where}` : where);

export default async function SettingsPage() {
  await requireConsole("settings");
  const { authorizations, secrets, staff } = await loadSettings(adminClient());
  return (
    <ConsoleMain>
      <PageTitle code="C14" title="Configurações" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <b>Autorizações dos donos</b>
          <div className={hint}>Uma por CNPJ. Sem autorização assinada, nenhum arquivo real entra.</div>
          {authorizations.map((a, i) => (
            <div key={i} className={row}>
              <span>
                <b>{a.title}</b>
                <br />
                <span className="text-xs text-ink-muted">{a.detail}</span>
              </span>
              <span className={`text-xs ${AUTH_COLOR[a.state]}`}>{a.status}</span>
            </div>
          ))}
        </Card>
        <Card>
          <b>Segredos</b>
          <div className={hint}>
            Ficam nas variáveis cifradas de cada plataforma (Vercel para o app, Maritime para os agentes, Supabase para o banco). Esta tela
            mostra a situação, nunca o valor.
          </div>
          {secrets.map((s) => (
            <div key={s.name} className={row} data-secret={s.name} data-state={s.state}>
              <span className="font-mono text-sm break-all">{s.name}</span>
              <span className={`text-xs ${SECRET_COLOR[s.state]}`}>{secretText(s.where, s.state)}</span>
            </div>
          ))}
          <div className="text-xs text-warn">Nada no repositório. Agentes de construção não acessam nenhuma delas.</div>
        </Card>
        <Card>
          <b>Equipe MargoAI no console</b>
          <div className={hint}>
            Dois papéis. Fundador: tudo. Operação: clientes, importações, de-para, fichas e entregas; não vê cobrança, segredos nem
            funcionalidades.
          </div>
          {staff.map((s, i) => (
            <div key={i} className={row}>
              <span>
                <b>{s.name}</b>
              </span>
              <span className="text-xs">{s.role}</span>
            </div>
          ))}
          {/* Staff invites need an invite flow for staff (no table yet); wired in a later task. */}
          <button type="button" disabled className="min-h-10 rounded-md border border-border-strong bg-surface text-md text-ink disabled:opacity-60">
            Convidar pessoa da operação
          </button>
        </Card>
        <Card className="gap-3">
          <b>Padrões do raio-X</b>
          {/* Params M1-01 and M1-04: defaults shown read-only until the settings table exists. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="r" className={hint}>
              Raio padrão
            </label>
            <input id="r" readOnly value={`${XRAY_DEFAULTS.radiusKm} km`} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="m" className={hint}>
              Mínimo de pares para comparar um item
            </label>
            <input id="m" readOnly value={XRAY_DEFAULTS.minPairs} className={field} />
          </div>
        </Card>
        <Card>
          <b>Dados de clientes</b>
          <div className="text-md leading-[1.6]">
            Banco: Supabase de produção, em São Paulo
            <br />
            Cada cliente aparece por código (G-02, G-03)
            <br />
            Agentes de construção só usam o banco de desenvolvimento, com dados sintéticos
            <br />
            Processamento nos agentes da Maritime (EUA ou Alemanha), previsto nos termos
          </div>
          <label htmlFor="ret" className={hint}>
            Apagar dados de cliente que saiu depois de
          </label>
          <select id="ret" disabled defaultValue={RETENTION_DAYS[0]} className={field}>
            {RETENTION_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} dias
              </option>
            ))}
          </select>
        </Card>
      </div>
    </ConsoleMain>
  );
}
