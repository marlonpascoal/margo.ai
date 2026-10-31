// P13 / W02 Lojas (design/P13-MinhasLojas.dc.html phone, design/W02-Lojas.dc.html computer; 05 §B).
// Every profile, data filtered by kitchen scope (A03); the toggle and the kitchen picker are Dono only.
import Link from "next/link";
import { AutoSubmitCheckbox, AutoSubmitSelect } from "@/components/AutoSubmit";
import { BUTTON_SECONDARY } from "@/components/console";
import { CARD, DeskFictitious, DeskTitle, Notice, PHONE_PRIMARY, PhoneTop, PortalMain, TD, TH } from "@/components/portal";
import { plural } from "@/lib/m2/format";
import { canPortal } from "@/lib/permissions";
import { requirePortal } from "@/lib/portal/account-access";
import { loadLojas, lojasLead } from "@/lib/portal/lojas";
import { adminClient } from "@/lib/supabase/admin";
import { linkNewStoreAction, setInAnalysisAction } from "./actions";

export const metadata = { title: "Lojas · MargoAI" };

const PILL: Record<string, string> = { ifood: "bg-danger-bg", food99: "bg-warn-bg", keeta: "bg-sunken", rappi: "bg-sunken" };

export default async function LojasPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const m = await requirePortal();
  const q = await searchParams;
  const v = await loadLojas(adminClient(), m.account.id, m);
  const dono = canPortal(m.role, "choose_kitchens");

  const toggle = (k: (typeof v.kitchens)[number], extra: string) =>
    dono ? (
      <form action={setInAnalysisAction} className="contents">
        <input type="hidden" name="cozinha" value={k.id} />
        <input type="hidden" name="ligar" value={String(!k.inAnalysis)} />
        <AutoSubmitCheckbox defaultChecked={k.inAnalysis} aria-label={`Incluir ${k.name}`} className={`h-4.5 w-4.5 ${extra}`} />
      </form>
    ) : (
      <input type="checkbox" checked={k.inAnalysis} disabled readOnly aria-label={`Incluir ${k.name}`} className={`h-4.5 w-4.5 ${extra}`} />
    );

  return (
    <PortalMain>
      <PhoneTop synthetic={m.account.isSynthetic} />
      <Notice text={q.aviso} />

      {/* Phone (P13) */}
      <h1 className="m-0 text-[22px] leading-tight md:hidden">Encontramos {plural(v.stores, "loja", "lojas")} na sua autorização</h1>
      <p className="m-0 text-md leading-normal text-ink-2 md:hidden">Agrupamos por cozinha. Confira e escolha quais entram na análise. A cobrança é por cozinha, não por marca.</p>
      <div className="flex flex-wrap gap-3 text-xs text-ink-muted md:hidden">
        <span>
          Conta: <b>{m.account.name}</b>
        </span>
        <span>{plural(v.companies, "CNPJ", "CNPJs")}</span>
        <span>{plural(v.kitchens.length, "cozinha", "cozinhas")}</span>
      </div>
      <div className="flex flex-col gap-3 md:hidden" data-phone-kitchens>
        {v.kitchens.map((k) => (
          <div key={k.id} className={`${CARD} flex flex-col gap-2 p-3`} data-kitchen={k.name}>
            <div className="flex items-start gap-2.5">
              {toggle(k, "mt-0.5")}
              <span className="text-base leading-snug">
                <b>{k.name}</b>
                <br />
                <span className="text-xs text-ink-muted">{k.cnpjLine}</span>
              </span>
            </div>
            {k.stores.map((s) => (
              <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-border-subtle pt-1.5 pl-7 text-sm">
                <span>
                  {s.brand}{" "}
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-xs">
                      ver no app
                    </a>
                  )}
                </span>
                <span className={`rounded-full px-2 py-px text-xs ${PILL[s.channel]}`}>{s.app}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Computer (W02) */}
      <DeskTitle title="Lojas" lead={`${lojasLead(m.account.name, v)} A cobrança é por cozinha na análise.`}>
        <div className="flex items-center gap-3">
          <DeskFictitious synthetic={m.account.isSynthetic} />
          <Link href="/app/conectar" className={BUTTON_SECONDARY}>
            Conectar apps e extensão
          </Link>
        </div>
      </DeskTitle>
      <div className={`${CARD} hidden overflow-x-auto md:block`}>
        <table className="w-full min-w-[860px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              {["Na análise", "Cozinha", "CNPJ", "Lojas nos apps", "Dados chegando"].map((h) => (
                <th key={h} className={TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.kitchens.map((k) => (
              <tr key={k.id} data-kitchen={k.name}>
                <td className={TD}>{toggle(k, "")}</td>
                <td className={TD}>
                  <b>{k.name}</b>
                  <br />
                  <span className="text-xs text-ink-muted">{k.address}</span>
                </td>
                <td className={`${TD} font-mono text-xs`}>{k.cnpjTail}</td>
                <td className={`${TD} text-sm leading-relaxed`}>
                  {k.storesLine}
                  {k.storesLink && (
                    <details>
                      <summary className="cursor-pointer text-xs underline">{k.storesLink}</summary>
                      <ul className="m-0 list-none p-0 text-xs">
                        {k.stores.map((s) => (
                          <li key={s.id}>
                            {s.brand} ({s.app}){" "}
                            {s.url && (
                              <a href={s.url} target="_blank" rel="noreferrer">
                                ver no app
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className={`${TD} text-sm ${k.arrivingTone === "ok" ? "text-ok" : "text-ink-muted"}`}>{k.arriving}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {v.newStores.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-border bg-warn-bg px-4.5 py-3.5 text-md" data-new-store>
          <span>{s.text}</span>
          <form action={linkNewStoreAction}>
            <input type="hidden" name="loja" value={s.id} />
            <AutoSubmitSelect name="cozinha" aria-label="Cozinha da loja nova" disabled={!dono} defaultValue="" className="min-h-10 rounded-md border border-border-strong bg-surface px-2.5">
              <option value="">Escolher cozinha</option>
              {v.kitchens.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.short}
                </option>
              ))}
            </AutoSubmitSelect>
          </form>
        </div>
      ))}

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex justify-between text-md md:hidden">
          <span>Cozinhas na análise</span>
          <b className="font-mono" data-in-analysis>
            {v.inAnalysis} de {v.kitchens.length}
          </b>
        </div>
        {dono && (
          <Link href="/app/pessoas" className={`${PHONE_PRIMARY} md:hidden`}>
            Confirmar e convidar a equipe
          </Link>
        )}
        <div className="text-xs leading-normal text-ink-muted">A 99Food não tem API: as lojas de lá aparecem quando você mandar o primeiro extrato.</div>
      </div>
    </PortalMain>
  );
}
