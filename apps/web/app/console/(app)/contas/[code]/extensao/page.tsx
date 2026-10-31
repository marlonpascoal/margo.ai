// P04 from the console (06 §9, D01a): who has the Chrome extension paired for this account, a pairing code for
// a person, and revoking. Reached from C07 "Ver a extensão". Not a drawn screen: copy short and listed.
// Flag m2.extensao_chrome (A05: off is 404). Fundador and Operação.
import Link from "next/link";
import { Card, ConsoleMain, FictitiousLabel, PageTitle, Pill } from "@/components/console";
import { requireConsole } from "@/lib/console/staff";
import { requireFlag } from "@/lib/flags";
import { dayMonth, TIME_ZONE } from "@/lib/format";
import { accountByCode } from "@/lib/m2/account";
import { ROLE_LABEL } from "@/lib/notify/templates";
import { loadExtensionTokens } from "@/lib/extension/server";
import { adminClient } from "@/lib/supabase/admin";
import { revokeAction } from "./actions";
import PairingCodeForm from "./PairingCodeForm";

export const metadata = { title: "Extensão do Chrome · MargoAI" };

const th = "border-b border-border px-3 py-2.5 font-normal";
const td = "border-b border-border-subtle px-3 py-2.25";
const when = (iso: string) => `${dayMonth(new Date(iso))} ${new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))}`;

export default async function ExtensionPage({ params }: { params: Promise<{ code: string }> }) {
  await requireConsole("clients");
  const { code } = await params;
  const db = adminClient();
  const account = await accountByCode(db, code);
  await requireFlag("m2.extensao_chrome", account.id);
  const { members, rows } = await loadExtensionTokens(db, account.id);
  const name = new Map(members.map((m) => [m.personId, m.name]));
  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle code="P04" kicker={`P04 · Módulo 2 · ${account.name} (${account.code})`} title="Extensão do Chrome" lead="Cada pessoa pareia a extensão no próprio computador com um código. A extensão só manda o arquivo que a pessoa escolhe, na página do Portal do Parceiro que ela abriu." />
        {account.isSynthetic && <FictitiousLabel />}
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[3_1_520px] overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-md">
            <thead>
              <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                <th className={th}>Pessoa</th>
                <th className={th}>Situação</th>
                <th className={th}>Último uso</th>
                <th className={th}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className={`${td} text-ink-muted`}>
                    Ninguém pareou a extensão ainda.
                  </td>
                </tr>
              )}
              {rows.map((t) => (
                <tr key={t.id} data-token={t.id}>
                  <td className={td}>{name.get(t.person_id) ?? ""}</td>
                  <td className={td}>
                    {t.revoked_at ? (
                      <Pill tone="muted">revogada em {when(t.revoked_at)}</Pill>
                    ) : t.paired_at ? (
                      <Pill tone="ok">pareada em {when(t.paired_at)}</Pill>
                    ) : (
                      <Pill tone="warn">código vale até {when(t.pairing_expires_at!)}</Pill>
                    )}
                  </td>
                  <td className={`${td} font-mono text-xs`}>{t.last_used_at ? when(t.last_used_at) : ""}</td>
                  <td className={td}>
                    {!t.revoked_at && (
                      <form action={revokeAction}>
                        <input type="hidden" name="conta" value={account.code} />
                        <input type="hidden" name="token" value={t.id} />
                        <button type="submit" aria-label={`revogar: ${name.get(t.person_id) ?? ""}`} className="min-h-8 cursor-pointer rounded-sm border border-border-strong bg-surface px-2 text-sm text-ink">
                          revogar
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Card className="min-w-0 flex-[2_1_320px]">
          <b>Código para parear</b>
          <PairingCodeForm account={account.code} people={members.map((m) => ({ id: m.personId, label: `${m.name} (${ROLE_LABEL[m.role]})` }))} />
        </Card>
      </div>
      <Link href={`/console/contas/${account.code}/importacoes`} className="text-sm">
        Voltar para Conectar e importar
      </Link>
    </ConsoleMain>
  );
}
