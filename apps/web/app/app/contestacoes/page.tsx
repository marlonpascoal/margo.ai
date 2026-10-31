// P12 / W03 Contestações (design/P12-Contestacoes.dc.html phone, design/W03-Contestacoes.dc.html
// computer; 05 §B, 04 §3, D30). Flag m2.contestacao. Gerente sees only their kitchens (A03).
import { CopyButton } from "@/components/AutoSubmit";
import { CARD, DeskFictitious, DeskTitle, Notice, PhoneTop, PortalMain, SMALL_BUTTON, SMALL_BUTTON_DARK, TD, TH } from "@/components/portal";
import { requirePortal } from "@/lib/portal/account-access";
import { infoOf, kitchenApp, loadOwnerContestations, money, ownerTotals, PILL_LABEL, PILL_TONE, pillOf, whatHappened, type OwnerContestation } from "@/lib/portal/contestacoes";
import { adminClient } from "@/lib/supabase/admin";
import { markContestationAction } from "./actions";

export const metadata = { title: "Contestações · MargoAI" };

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** One owner button: a form posting the event of public.contestation_mark. */
function Mark({ r, event, label, dark, className = "" }: { r: OwnerContestation; event: string; label: string; dark?: boolean; className?: string }) {
  return (
    <form action={markContestationAction} className={`inline ${className}`}>
      <input type="hidden" name="contestacao" value={r.contestationId!} />
      <input type="hidden" name="evento" value={event} />
      <button type="submit" className={dark ? SMALL_BUTTON_DARK : SMALL_BUTTON}>
        {label}
      </button>
    </form>
  );
}

/** "Já contestei" asks for the protocol, optional (05 P12/W03). Computer: inline in the row. */
function Contested({ r }: { r: OwnerContestation }) {
  return (
    <form action={markContestationAction} className="inline-flex gap-1.5">
      <input type="hidden" name="contestacao" value={r.contestationId!} />
      <input type="hidden" name="evento" value="ja_contestei" />
      <input name="protocolo" aria-label="Protocolo (opcional)" placeholder="protocolo (opcional)" maxLength={60} className="min-h-8.5 w-36 rounded-sm border border-border-strong px-2 text-sm" />
      <button type="submit" className={SMALL_BUTTON_DARK}>
        Já contestei
      </button>
    </form>
  );
}

/** Phone: the protocol on its own line, then "Copiar texto pronto" and "Já contestei" side by side, as drawn. */
function ContestedPhone({ r }: { r: OwnerContestation }) {
  const form = `jc-${r.contestationId}`;
  return (
    <>
      <form id={form} action={markContestationAction} className="hidden">
        <input type="hidden" name="contestacao" value={r.contestationId!} />
        <input type="hidden" name="evento" value="ja_contestei" />
      </form>
      <input form={form} name="protocolo" aria-label="Protocolo (opcional)" placeholder="protocolo (opcional)" maxLength={60} className="min-h-9 rounded-sm border border-border-strong px-2 text-sm" />
      <div className="flex gap-1.5">
        {r.claimText && <CopyButton text={r.claimText} label="Copiar texto pronto" className={`${SMALL_BUTTON} min-h-9 flex-1`} />}
        <button form={form} type="submit" className={`${SMALL_BUTTON_DARK} min-h-9 flex-1`}>
          Já contestei
        </button>
      </div>
    </>
  );
}

export default async function ContestacoesPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const m = await requirePortal({ action: "contestations", flags: ["m2.contestacao"] });
  const q = await searchParams;
  const rows = await loadOwnerContestations(adminClient(), m.account.id, m);
  const t = ownerTotals(rows);
  const day = today();
  const desk = [
    { v: t.toContest, l: "para você contestar", c: "bg-danger-bg" },
    { v: t.inAnalysis, l: "em análise no app", c: "border border-border bg-surface" },
    { v: t.back, l: "já voltou", c: "bg-ok-bg" },
    { v: t.needsAnswer, l: "precisa da sua resposta", c: "bg-warn-bg" },
  ];
  const phone = [desk[2], desk[1], desk[0], desk[3]];

  return (
    <PortalMain>
      <PhoneTop synthetic={m.account.isSynthetic} />
      <Notice text={q.aviso} />
      <h1 className="m-0 text-[22px] md:hidden">Minhas contestações</h1>
      <DeskTitle title="Contestações" lead="Você abre o chamado no Portal do Parceiro com o texto pronto. Aqui você marca o que já fez; o crédito a gente confere no repasse." />

      <div className="grid grid-cols-2 gap-1.5 text-xs md:hidden" data-totals-phone>
        {phone.map((c) => (
          <div key={c.l} className={`rounded-md p-2 ${c.c}`}>
            <b className="font-mono text-base">{money(c.v)}</b>
            <br />
            {c.l}
          </div>
        ))}
      </div>
      <div className="hidden grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5 md:grid" data-totals>
        {desk.map((c) => (
          <div key={c.l} className={`rounded-lg p-3 ${c.c}`}>
            <b className="font-mono text-xl">{money(c.v)}</b>
            <br />
            <span className="text-sm">{c.l}</span>
          </div>
        ))}
      </div>

      {/* Phone (P12) */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((r) => {
          const p = pillOf(r);
          return (
            <div key={r.differenceId} className={`${CARD} flex flex-col gap-1.5 rounded-lg px-3 py-2.5`} data-contestation={r.rule}>
              <div className="flex items-baseline justify-between gap-2">
                <b className="text-md leading-tight">{whatHappened(r)}</b>
                <span className="font-mono text-md font-semibold">{money(r.amount)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 ${PILL_TONE[p]}`}>{PILL_LABEL[p].p12}</span>
                <span className="text-ink-muted">{infoOf(r, day).p12}</span>
              </div>
              {p === "contestar" && r.contestationId && <ContestedPhone r={r} />}
              {p === "analise" && r.contestationId && (
                <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <span className="flex-1">Conferimos o crédito no próximo repasse.</span>
                  <Mark r={r} event="foi_negada" label="Foi negada" />
                </div>
              )}
              {p === "resposta" && r.contestationId && (
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="flex-1">Esse desconto foi combinado com o iFood?</span>
                  <Mark r={r} event="foi_combinado_sim" label="Sim" />
                  <Mark r={r} event="foi_combinado_nao" label="Não" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Computer (W03) */}
      <div className={`${CARD} hidden overflow-x-auto md:block`}>
        <table className="w-full min-w-[900px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              <th className={TH}>O que aconteceu</th>
              <th className={TH}>Cozinha e app</th>
              <th className={`${TH} text-right`}>Valor</th>
              <th className={TH}>Status</th>
              <th className={TH}>Prazo ou protocolo</th>
              <th className={TH}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = pillOf(r);
              return (
                <tr key={r.differenceId} data-contestation={r.rule}>
                  <td className={TD}>{whatHappened(r)}</td>
                  <td className={`${TD} text-sm`}>{kitchenApp(r)}</td>
                  <td className={`${TD} text-right font-mono whitespace-nowrap`}>{money(r.amount)}</td>
                  <td className={TD}>
                    <span className={`rounded-full px-2.5 py-0.75 text-xs whitespace-nowrap ${PILL_TONE[p]}`}>{PILL_LABEL[p].w03}</span>
                  </td>
                  <td className={`${TD} text-sm text-ink-muted`}>{infoOf(r, day).w03}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {p === "contestar" && r.contestationId && (
                      <span className="inline-flex gap-1.5">
                        {r.claimText && <CopyButton text={r.claimText} label="Copiar texto" className={SMALL_BUTTON} />}
                        <Contested r={r} />
                      </span>
                    )}
                    {p === "analise" && r.contestationId && <Mark r={r} event="foi_negada" label="Foi negada" />}
                    {p === "resposta" && r.contestationId && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-sm">Foi combinado?</span>
                        <Mark r={r} event="foi_combinado_sim" label="Sim" />
                        <Mark r={r} event="foi_combinado_nao" label="Não" />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DeskFictitious synthetic={m.account.isSynthetic} />
    </PortalMain>
  );
}
