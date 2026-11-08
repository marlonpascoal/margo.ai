// P08 Minha conta (phone) and W01 Início (computer), one route (D32). Every number is filtered by the
// person's kitchens (04 §5, A03) and traces to a rule: REP-05 (vendido, recebido), REP-01 to REP-04
// (o app levou), DIF-01 to DIF-05 (cobrado errado), CTB-01 (sobrou: received minus the insumos of the
// dishes sold, "falta custo" while unknown). DLV-01 ("Uma decisão para ...") is the whole-account close's
// decision, shown only to people who see every kitchen (A03), like the closing PDF.
import Link from "next/link";
import { notFound } from "next/navigation";
import NavSelect from "@/components/NavSelect";
import { FictitiousLabel } from "@/components/console";
import { isEnabled } from "@/lib/flags";
import { brl, monthLong, reais } from "@/lib/m2/format";
import { loadDecision } from "@/lib/m3/data";
import { decisionW01 } from "@/lib/m3/format";
import { canPortal } from "@/lib/permissions";
import { dayMon, kitchenShort, trialDaysLeft, trialUsedPct } from "@/lib/portal/format";
import { homeNumbers, homePeriods, loadHomeDiffs, loadHomeLines, loadReports, scopeKitchens, withoutCost } from "@/lib/portal/home";
import { requireMember, type Member } from "@/lib/portal/session";
import { extensionPaired } from "@/lib/portal/admin-reads";
import type { ReadDb } from "@/lib/supabase/reader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Início · MargoAI" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Trial {
  daysLeft: number;
  usedPct: number;
}

/** 04 §7 trial banner: Dono only (05 P08/W01), while the subscription is in trial. */
async function loadTrial(db: ReadDb, m: Member, now: Date): Promise<Trial | null> {
  if (!canPortal(m.role, "billing") || !m.account.trialEndsAt) return null;
  const { data } = await db.from("subscription").select("status, plan(trial_days)").eq("account_id", m.account.id).maybeSingle();
  if (data?.status !== "trial") return null;
  const daysLeft = trialDaysLeft(m.account.trialEndsAt, now);
  return { daysLeft, usedPct: trialUsedPct(daysLeft, data.plan?.trial_days ?? 14) };
}

/** P08 list counts, in scope. */
async function loadCounts(db: ReadDb, m: Member, flags: { contest: boolean; people: boolean; extension: boolean }) {
  const scope = m.kitchenIds;
  const [people, contest, ifood, ext] = await Promise.all([
    canPortal(m.role, "people") ? db.from("membership").select("id", { count: "exact", head: true }).eq("account_id", m.account.id) : Promise.resolve({ count: 1 }),
    flags.contest
      ? db
          .from("contestation")
          .select("status, closed_at, difference!inner(channel_store!inner(kitchen_id))")
          .eq("account_id", m.account.id)
          .in("status", ["a_contestar", "precisa_resposta"])
          .is("closed_at", null)
      : Promise.resolve({ data: [] }),
    db.from("channel_store").select("kitchen_id").eq("account_id", m.account.id).eq("channel", "ifood").eq("authorized", true),
    flags.extension ? extensionPaired(m.account.id) : Promise.resolve(false),
  ]);
  const inScope = (k: string | null | undefined) => m.allKitchens || (!!k && scope.includes(k));
  const toDo = ((contest.data ?? []) as { difference: { channel_store: { kitchen_id: string | null } | null } | null }[]).filter((c) => inScope(c.difference?.channel_store?.kitchen_id)).length;
  return {
    kitchens: scope.length,
    people: people.count ?? 0,
    toDo,
    ifood: (ifood.data ?? []).some((s) => inScope(s.kitchen_id)),
    extension: ext,
  };
}

export default async function InicioPage({ searchParams }: { searchParams: Promise<{ mes?: string; cozinha?: string }> }) {
  const m = await requireMember();
  if (!canPortal(m.role, "see_close")) notFound();
  const db = m.db;
  const now = new Date();
  const sp = await searchParams;

  const [contest, people, extension, cost, raioX] = await Promise.all([
    isEnabled("m2.contestacao", m.account.id),
    isEnabled("conta.pessoas", m.account.id),
    isEnabled("m2.extensao_chrome", m.account.id),
    isEnabled("m3.custo", m.account.id),
    // P19 on the phone: MenuDono shows no entries there, so P08 lists the Raio-X journey (m1.portal, see_xray).
    canPortal(m.role, "see_xray") ? isEnabled("m1.portal", m.account.id) : Promise.resolve(false),
  ]);
  const [kitchens, periods, reports, trial, counts] = await Promise.all([
    scopeKitchens(db, m),
    homePeriods(m),
    loadReports(db, m),
    loadTrial(db, m, now),
    loadCounts(db, m, { contest, people, extension }),
  ]);

  const period = periods.find((p) => p.month.slice(0, 7) === sp.mes) ?? periods[0] ?? null;
  const shown = kitchens.filter((k) => k.inAnalysis);
  const kitchen = shown.find((k) => k.id === sp.cozinha) ?? null;
  const [lines, diffs] = period ? await Promise.all([loadHomeLines(db, period.id, m), loadHomeDiffs(db, period.id, m)]) : [[], []];
  // m3.custo off: "sobrou" falls back to "falta custo" and there is no DLV-01 decision (04 §6).
  const n = homeNumbers(cost ? lines : withoutCost(lines), diffs, kitchen?.id ?? null);
  const decision = period && m.allKitchens && cost ? await loadDecision(db, period.id, period.month) : null;
  const dlv = decision ? decisionW01(decision) : null;
  const href = (mes: string | null, coz: string | null) => {
    const q = new URLSearchParams();
    if (mes) q.set("mes", mes);
    if (coz) q.set("cozinha", coz);
    const s = q.toString();
    return s ? `/app?${s}` : "/app";
  };
  const mes = period?.month.slice(0, 7) ?? null;
  const closeReport = reports.find((r) => r.kind === "close");
  const xrayReport = reports.find((r) => r.kind === "xray");
  const listLink = "flex justify-between px-3.5 py-3.25 text-base no-underline";
  const sub = "text-sm text-ink-muted";

  return (
    <>
      {/* P08 Minha conta, phone */}
      <main className="box-border flex flex-col gap-3.5 px-4 py-5 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <h1 className="m-0 text-2xl">{m.account.name}</h1>
          {m.account.isSynthetic && <FictitiousLabel />}
        </div>
        {trial && (
          <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5">
            <div className="flex items-center justify-between">
              <b>Teste grátis</b>
              <span className="rounded-full bg-warn-bg px-2.5 py-0.75 text-xs">faltam {trial.daysLeft} dias</span>
            </div>
            <div className="h-2 rounded-xs bg-sunken">
              <div className="h-2 rounded-xs bg-ink" style={{ width: `${trial.usedPct}%` }} />
            </div>
            <Link href="/app/plano" className="flex min-h-11 items-center justify-center rounded-md bg-ink font-bold text-ink-inverse no-underline hover:text-ink-inverse">
              Escolher um plano
            </Link>
          </div>
        )}
        <nav aria-label="Conta" className="flex flex-col rounded-xl border border-border bg-surface [&>*+*]:border-t [&>*+*]:border-border-subtle">
          {raioX && (
            <Link href="/app/raio-x" className={listLink}>
              <span>Raio-X</span>
              <span className={sub}>lojas que você acompanha</span>
            </Link>
          )}
          {xrayReport && (
            <a href={xrayReport.href} className={listLink}>
              <span>Raio-X de preço</span>
              <span className={sub}>{xrayReport.at ? dayMon(new Date(xrayReport.at)) : ""}</span>
            </a>
          )}
          {closeReport && (
            <a href={closeReport.href} className={listLink}>
              <span>Fechamento de {monthLong(closeReport.month!)}</span>
              <span className={sub}>{closeReport.at ? dayMon(new Date(closeReport.at)) : ""}</span>
            </a>
          )}
          <Link href="/app/lojas" className={listLink}>
            <span>Minhas lojas</span>
            <span className={sub}>{plural(counts.kitchens, "cozinha", "cozinhas")}</span>
          </Link>
          {people && (
            <Link href="/app/pessoas" className={listLink}>
              <span>Pessoas e acessos</span>
              <span className={sub}>{plural(counts.people, "pessoa", "pessoas")}</span>
            </Link>
          )}
          {contest && (
            <Link href="/app/contestacoes" className={listLink}>
              <span>Minhas contestações</span>
              <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs">{counts.toDo} para fazer</span>
            </Link>
          )}
        </nav>
        <div className="flex flex-col rounded-xl border border-border bg-surface px-3.5 py-1 text-md [&>*+*]:border-t [&>*+*]:border-border-subtle">
          <div className="flex justify-between py-2.5">
            <span>iFood</span>
            <span className={counts.ifood ? "text-ok" : "text-ink-muted"}>{counts.ifood ? "autorizado" : "não autorizado"}</span>
          </div>
          {extension && (
            <div className="flex justify-between py-2.5">
              <span>Extensão do Chrome</span>
              <span className={counts.extension ? "text-ok" : "text-ink-muted"}>{counts.extension ? "instalada" : "não instalada"}</span>
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-col gap-2 text-md">
          <Link href="/app/notificacoes">Notificações</Link>
          <Link href="/app/seguranca">Segurança e aparelhos</Link>
          <Link href="/termos">Termos e privacidade</Link>
          <Link href="/app/seguranca#dados">Como revogar o acesso ao iFood</Link>
          {canPortal(m.role, "delete_account") && (
            <Link href="/app/seguranca#dados" className="text-danger">
              Excluir meus dados
            </Link>
          )}
          {m.manyAccounts && <Link href="/entrar/conta">Trocar de grupo</Link>}
        </div>
      </main>

      {/* W01 Início, computer */}
      <main className="mx-auto box-border hidden max-w-[1180px] flex-col gap-5 px-8 py-7 md:flex">
        {trial && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-border bg-warn-bg px-4.5 py-3.5">
            <span className="text-base">
              Teste grátis: faltam <b>{plural(trial.daysLeft, "dia", "dias")}</b>. Depois disso, escolha um plano para seguir com o fechamento.
            </span>
            <Link href="/app/plano" className="inline-flex min-h-10 items-center rounded-md bg-ink px-4 text-md font-semibold text-ink-inverse no-underline hover:text-ink-inverse">
              Escolher plano
            </Link>
          </div>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="m-0 text-4xl">{period ? `${capital(monthLong(period.month))} de ${period.month.slice(0, 4)}` : "Início"}</h1>
          <div className="flex items-center gap-2">
            {periods.length > 1 && (
              <NavSelect
                label="Mês"
                value={mes ?? ""}
                options={periods.map((p) => ({ value: p.month.slice(0, 7), label: `${capital(monthLong(p.month))} de ${p.month.slice(0, 4)}`, href: href(p.month.slice(0, 7), kitchen?.id ?? null) }))}
                className="min-h-10 text-md"
              />
            )}
            {shown.length > 0 && (
              <>
                <span className="text-sm text-ink-muted">Cozinha</span>
                <NavSelect
                  label="Cozinha"
                  value={kitchen?.id ?? ""}
                  options={[
                    ...(shown.length > 1 ? [{ value: "", label: `Todas (${shown.length})`, href: href(mes, null) }] : []),
                    ...shown.map((k) => ({ value: k.id, label: kitchenShort(k.name), href: href(mes, k.id) })),
                  ]}
                  className="min-h-10 text-md"
                />
              </>
            )}
            {m.account.isSynthetic && <FictitiousLabel />}
          </div>
        </div>
        {!period ? (
          <p className="m-0 text-base text-ink-muted">O primeiro fechamento aparece aqui quando os dados dos apps chegarem.</p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              <Kpi value={brl(n.soldCents)} label="vendido no delivery" />
              <Kpi value={brl(n.receivedCents)} label={`recebido dos apps (${n.receivedPct}%)`} />
              {n.leftCents === null ? (
                <Kpi value="falta custo" label="sobrou depois dos insumos" tone="muted" />
              ) : (
                <Kpi value={brl(n.leftCents)} label={`sobrou depois dos insumos (${n.leftPct}%)`} tone="ok" />
              )}
              {contest && (
                <Link href="/app/contestacoes" className="rounded-xl border border-danger-border bg-danger-bg p-4 no-underline">
                  <div className="font-mono text-3xl">{brl(n.wrongCents)}</div>
                  <div className="text-sm">cobrado errado: {n.toContest} para você contestar</div>
                </Link>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-5">
              <div className="min-w-0 flex-[3_1_520px] overflow-x-auto rounded-xl border border-border bg-surface">
                <table className="w-full min-w-[520px] border-collapse text-md">
                  <thead>
                    <tr className="text-right text-xs tracking-[0.04em] text-ink-muted uppercase">
                      <th className="border-b border-border px-3.5 py-3 text-left">Cozinha e app</th>
                      <th className="border-b border-border px-3.5 py-3">Vendido</th>
                      <th className="border-b border-border px-3.5 py-3">O app levou</th>
                      <th className="border-b border-border px-3.5 py-3">Sobrou</th>
                    </tr>
                  </thead>
                  <tbody className="text-right font-mono [&>tr:not(:last-child)>td]:border-b [&>tr:not(:last-child)>td]:border-border-subtle">
                    {n.rows.map((r) => (
                      <tr key={r.label}>
                        <td className="px-3.5 py-2.75 text-left font-sans">{r.label}</td>
                        <td className="pr-3.5">{reais(r.soldCents)}</td>
                        <td className="pr-3.5 text-danger">{reais(r.appTookCents)}</td>
                        {r.leftCents === null ? (
                          <td className="pr-3.5 font-sans text-sm text-ink-muted">falta custo</td>
                        ) : (
                          <td className="pr-3.5 text-ok">{reais(r.leftCents)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(reports.length > 0 || dlv) && (
                <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-3">
                  {reports.length > 0 && (
                  <div className="flex flex-col rounded-xl border border-border bg-surface [&>*+*]:border-t [&>*+*]:border-border-subtle">
                    <b className="border-b border-border px-3.5 py-3">Relatórios</b>
                    {closeReport && (
                      <a href={closeReport.href} className="flex justify-between px-3.5 py-3 text-md no-underline">
                        <span>Fechamento de {monthLong(closeReport.month!)}</span>
                        <span className="text-ink-muted">PDF</span>
                      </a>
                    )}
                    {xrayReport && (
                      <a href={xrayReport.href} className="flex justify-between px-3.5 py-3 text-md no-underline">
                        <span>Raio-X de preço</span>
                        <span className="text-ink-muted">PDF</span>
                      </a>
                    )}
                  </div>
                  )}
                  {dlv && (
                    <div className="rounded-xl border border-danger-border bg-danger-bg p-3.5 text-md leading-normal" data-decision>
                      <b>{dlv[0]}</b> {dlv[1]}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Kpi({ value, label, tone }: { value: string; label: string; tone?: "muted" | "ok" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className={tone === "muted" ? "flex min-h-[42px] items-center text-xl text-ink-muted" : `font-mono text-3xl${tone === "ok" ? " text-ok" : ""}`}>{value}</div>
      <div className="text-sm text-ink-muted">{label}</div>
    </div>
  );
}
