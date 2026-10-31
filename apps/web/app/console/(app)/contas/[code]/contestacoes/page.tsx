// C16 Contestação (design/C16-Contestacao.dc.html, 05 §A, 04 §3, D30). Fundador and Operação, behind
// m2.contestacao. The owner files the claim in the app's portal; we prepare the text and the order sheet.
import Link from "next/link";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ConsoleMain, FictitiousLabel, PageTitle, TONE_BG } from "@/components/console";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode } from "@/lib/m2/account";
import { claimTitle, defaultSelection, loadContestations, money, nextStep, rowText, statusView, totals, whatsappLink, whoMarked, type Tone } from "@/lib/m2/contestations";
import { plural } from "@/lib/m2/format";
import { adminClient } from "@/lib/supabase/admin";
import { markDeniedAction } from "./actions";

export const metadata = { title: "Contestação · MargoAI" };

const th = "border-b border-border px-3.5 py-3 font-normal";
const td = "border-b border-border-subtle px-3.5 py-2.75";
const TONE: Record<Tone, keyof typeof TONE_BG> = { contestar: "danger", analise: "run", creditada: "ok", resposta: "warn", espera: "run", fim: "muted" };

export default async function ContestationsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ d?: string | string[]; aviso?: string }> }) {
  await requireConsole("clients");
  const { code } = await params;
  const q = await searchParams;
  const db = adminClient();
  const account = await accountByCode(db, code);
  await requireFlag("m2.contestacao", account.id);
  const rows = await loadContestations(db, account);
  const t = totals(rows);
  const wanted = Array.isArray(q.d) ? q.d[0] : q.d;
  const selected = rows.find((r) => r.differenceId === wanted && r.claimText) ?? defaultSelection(rows);
  const today = new Date().toISOString().slice(0, 10);
  const { data: dono } = await db.from("membership").select("person(whatsapp_e164)").eq("account_id", account.id).eq("role", "dono").limit(1).maybeSingle();
  const wa = selected?.claimText ? whatsappLink(dono?.person?.whatsapp_e164 ?? null, selected.claimText) : null;
  const cards: { value: number; label: string; bg: keyof typeof TONE_BG }[] = [
    { value: t.toContest, label: "a contestar", bg: "danger" },
    { value: t.contested, label: "contestada, em análise", bg: "surface" },
    { value: t.credited, label: "creditada", bg: "ok" },
    { value: t.denied, label: "negada", bg: "surface" },
    { value: t.waiting, label: "esperando o dono ou o repasse", bg: "warn" },
  ];

  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C16"
          kicker={`C16 · Módulo 2 · ${account.name}`}
          title="Contestação"
          lead="Quem abre o chamado no portal é o dono. A gente prepara o texto e a planilha, e acompanha o status junto com ele."
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {account.isSynthetic && <FictitiousLabel />}
          {/* W03 (owner portal) is wave 2; read-only impersonation opens it then. */}
          <span aria-disabled="true" className={`${BUTTON_PRIMARY} cursor-default opacity-50`}>
            Ver o que o dono vê
          </span>
        </div>
      </div>
      {q.aviso && (
        <p role="status" className="m-0 rounded-md border border-warn-border bg-warn-bg px-4 py-3 text-md">
          {q.aviso}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5" data-totals>
        {cards.map((c) => (
          <div key={c.label} className={`flex flex-col gap-1 rounded-lg border border-border p-3 ${TONE_BG[c.bg]}`}>
            <span className="font-mono text-xl">{money(c.value)}</span>
            <span className="text-xs text-ink-muted">{c.label}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="min-w-0 flex-[3_1_560px] overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-md">
            <thead>
              <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                {["Diferença", "Valor", "Status", "Quem marcou", "Próximo passo"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = statusView(r);
                return (
                  <tr key={r.differenceId} data-contestation={r.rule} className={selected?.differenceId === r.differenceId ? "bg-sunken" : ""}>
                    <td className={td}>
                      <span className="font-mono text-2xs text-ink-muted">{r.rule}</span>
                      <br />
                      {r.claimText ? (
                        <Link href={`?d=${r.differenceId}`} className="text-ink">
                          {rowText(r)}
                        </Link>
                      ) : (
                        rowText(r)
                      )}
                    </td>
                    <td className={`${td} font-mono whitespace-nowrap`}>{money(r.amount)}</td>
                    <td className={td}>
                      <span className={`inline-block rounded-full px-2.5 py-0.75 text-xs whitespace-nowrap ${TONE_BG[TONE[st.tone]]}`}>{st.label}</span>
                    </td>
                    <td className={`${td} text-sm`}>{whoMarked(r)}</td>
                    <td className={`${td} text-sm`}>
                      {nextStep(r, today)}
                      {r.status === "contestada" && !r.closed && r.contestationId && (
                        <form action={markDeniedAction} className="mt-1">
                          <input type="hidden" name="conta" value={account.code} />
                          <input type="hidden" name="contestacao" value={r.contestationId} />
                          <button type="submit" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-ink underline">
                            Foi negada
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {selected?.claimText && (
          <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-2.5 rounded-xl border border-border bg-surface p-4" data-claim={selected.rule}>
            <b>{claimTitle(selected)}</b>
            <label htmlFor="claim" className="text-xs text-ink-muted">
              O dono cola isto no chamado do Portal do Parceiro
            </label>
            <textarea id="claim" readOnly rows={7} defaultValue={selected.claimText} className="rounded-sm border border-border-strong p-2.5 text-sm leading-normal" />
            <div className="flex flex-wrap gap-2">
              <a href={`/console/contas/${account.code}/diferencas/${selected.differenceId}/pedidos`} className={`${BUTTON_SECONDARY} min-h-10 text-md`}>
                Baixar planilha ({plural(selected.orders, "pedido", "pedidos")})
              </a>
              {wa ? (
                <a href={wa} target="_blank" rel="noreferrer" className={`${BUTTON_PRIMARY} min-h-10 text-md`}>
                  Mandar ao dono no WhatsApp
                </a>
              ) : (
                <span aria-disabled="true" className={`${BUTTON_PRIMARY} min-h-10 text-md opacity-50`}>
                  Mandar ao dono no WhatsApp
                </span>
              )}
            </div>
            <div className="border-t border-border-subtle pt-2.5 text-xs text-ink-muted">
              Creditada é marcada pela MargoAI quando o valor aparece no repasse. Contestada e negada são marcadas pelo dono. Prazo vencido é automático.
            </div>
          </div>
        )}
      </div>
    </ConsoleMain>
  );
}
