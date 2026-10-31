// C07 Conectar e importar (design/C07-Conectar.dc.html, 05 §A, 04 §11, D31). Fundador and Operação.
// Flags m2.ifood_api, m2.extensao_chrome, m2.arquivo_ifood, m2.arquivo_99food: the screen shows while any is
// on for the account, each card while its own is.
import Link from "next/link";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, Card, ConsoleMain, FictitiousLabel, PageTitle, Pill } from "@/components/console";
import NavSelect from "@/components/NavSelect";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode, requireAnyFlag } from "@/lib/m2/account";
import { plural } from "@/lib/m2/format";
import { buildRunRows, countLine, loadImports, PAGE_SIZE, parseFilters, type Tone } from "@/lib/m2/imports";
import { closePeriods } from "@/lib/m2/close";
import { adminClient } from "@/lib/supabase/admin";
import { rerunAction, uploadAction } from "./actions";

export const metadata = { title: "Conectar e importar · MargoAI" };

const th = "border-b border-border px-3 py-2.5 font-normal";
const td = "border-b border-border-subtle px-3 py-2.25";
const TONE: Record<Tone, "ok" | "run" | "warn" | "danger"> = { ok: "ok", run: "run", warn: "warn", bad: "danger" };

type Search = { canal?: string; situacao?: string; pagina?: string; aviso?: string };

export default async function ImportsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Search> }) {
  await requireConsole("clients");
  const { code } = await params;
  const q = await searchParams;
  const db = adminClient();
  const account = await accountByCode(db, code);
  const flags = await requireAnyFlag(["m2.ifood_api", "m2.extensao_chrome", "m2.arquivo_ifood", "m2.arquivo_99food"], account.id);
  const filters = parseFilters(q);
  const { runs, total, since, cards, storeCount } = await loadImports(db, account, filters);
  const rows = buildRunRows(runs, new Date());
  const latestClose = (await closePeriods(db, account.id))[0];
  const base = `/console/contas/${account.code}/importacoes`;
  const href = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    const m = { canal: q.canal, situacao: q.situacao, ...over };
    if (m.canal) p.set("canal", m.canal);
    if (m.situacao) p.set("situacao", m.situacao);
    if (over.pagina) p.set("pagina", over.pagina);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fileChannels = [
    flags["m2.arquivo_99food"] ? { value: "food99", label: "99Food" } : null,
    flags["m2.arquivo_ifood"] ? { value: "ifood", label: "iFood (arquivo do portal)" } : null,
  ].filter((x): x is { value: string; label: string } => x !== null);

  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C07"
          kicker={`C07 · Módulo 2 · ${account.name} (${account.code}) · ${plural(storeCount, "loja de canal", "lojas de canal")}`}
          title="Conectar e importar"
          lead="Tudo roda em segundo plano. A gente só olha esta tela quando algo falha."
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {account.isSynthetic && <FictitiousLabel />}
          <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm" data-queue>
            <span className={`h-2 w-2 rounded-full ${cards.queue.running ? "bg-ok" : "bg-ink-faint"}`} />
            {cards.queue.running} rodando · {cards.queue.queued} na fila
          </span>
          {latestClose && (
            <Link href={`/console/contas/${account.code}/fechamento/${latestClose.month.slice(0, 7)}`} className={BUTTON_PRIMARY}>
              Ver fechamento
            </Link>
          )}
        </div>
      </div>

      {q.aviso && (
        <p role="status" className="m-0 rounded-md border border-warn-border bg-warn-bg px-4 py-3 text-md">
          {q.aviso}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        {flags["m2.ifood_api"] && (
          <Card>
            <div className="flex items-center justify-between gap-2">
              <b>iFood · API oficial</b>
              <Pill tone="ok">automático</Pill>
            </div>
            <div className="text-sm text-ink-2">
              Todo dia às 06:00, para as {cards.api?.stores ?? 0} lojas autorizadas. Busca os últimos 7 dias de novo, para pegar ajustes.
            </div>
            <div className="font-mono text-xs text-ink-muted">próxima: amanhã 06:00</div>
            <Link href={`/console/contas/${account.code}/estrutura`} className="text-sm">
              Ver o que o dono autorizou
            </Link>
          </Card>
        )}
        {flags["m2.extensao_chrome"] && (
          <Card>
            <div className="flex items-center justify-between gap-2">
              <b>Extensão do Chrome</b>
              <Pill tone="run">quando o navegador abre</Pill>
            </div>
            <div className="text-sm text-ink-2">Vendas por item e promoções. Envia sozinha uma vez por dia, quando o dono abre o Portal do Parceiro.</div>
            {cards.extension?.stale && <div className="font-mono text-xs text-warn">sem envio há 3 dias: lembrar o dono</div>}
            {/* P04 (the extension) is wave 2; the link opens it once it exists. */}
            <span aria-disabled="true" className="text-sm text-ink-faint underline">
              Ver a extensão
            </span>
          </Card>
        )}
        {fileChannels.length > 0 && (
          <section className="flex flex-col gap-2.5 rounded-xl border border-dashed border-ink-faint bg-surface p-3.5">
            <b>Arquivos</b>
            <div className="text-sm text-ink-2">99Food e outros. Chegam por upload aqui, pela pasta do BPO ou pelo WhatsApp, e entram na mesma fila.</div>
            <form action={uploadAction} className="flex flex-col gap-2">
              <input type="hidden" name="conta" value={account.code} />
              <label className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-ink-muted">
                Arraste arquivos aqui
                <input type="file" name="arquivo" accept=".csv,.xlsx" aria-label="Arquivo" className="max-w-full text-xs" />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select name="canal" aria-label="Canal do arquivo" className="min-h-9 rounded-sm border border-border-strong bg-surface px-2 text-sm">
                  {fileChannels.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button type="submit" className="min-h-9 cursor-pointer rounded-sm border border-border-strong bg-surface px-3 text-sm text-ink">
                  Importar
                </button>
              </div>
            </form>
          </section>
        )}
      </div>

      <section className="flex flex-col rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
          <b>Histórico de importações</b>
          <div className="flex flex-wrap gap-2">
            <NavSelect
              label="Canal"
              value={filters.channel ?? ""}
              options={[
                { value: "", label: "Todos os canais", href: href({ canal: undefined }) },
                { value: "ifood", label: "iFood", href: href({ canal: "ifood" }) },
                { value: "food99", label: "99Food", href: href({ canal: "food99" }) },
              ]}
            />
            <NavSelect
              label="Situação"
              value={filters.errorsOnly ? "erro" : ""}
              options={[
                { value: "", label: "Todas as situações", href: href({ situacao: undefined }) },
                { value: "erro", label: "Com erro", href: href({ situacao: "erro" }) },
              ]}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-2xs tracking-[0.04em] text-ink-muted uppercase">
                {["Quando", "Disparo", "Canal e fonte", "Lojas", "Período", "Linhas", "Duração", "Situação", "Ações"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-run={r.id}>
                  <td className={`${td} font-mono text-xs whitespace-nowrap`}>{r.when}</td>
                  <td className={td}>{r.trigger}</td>
                  <td className={td}>{r.source}</td>
                  <td className={td}>{r.stores}</td>
                  <td className={`${td} font-mono text-xs`}>{r.period}</td>
                  <td className={`${td} font-mono`}>{r.rows}</td>
                  <td className={td}>{r.duration}</td>
                  <td className={td}>
                    <Pill tone={TONE[r.tone]}>{r.status}</Pill>
                  </td>
                  <td className={`${td} text-xs`}>
                    {r.action?.href && <Link href={r.action.href}>{r.action.label}</Link>}
                    {r.action?.rerun && (
                      <form action={rerunAction}>
                        <input type="hidden" name="conta" value={account.code} />
                        <input type="hidden" name="run" value={r.id} />
                        <button type="submit" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-ink underline">
                          {r.action.label}
                        </button>
                      </form>
                    )}
                    {r.action && !r.action.href && !r.action.rerun && (
                      <details>
                        <summary className="cursor-pointer underline">{r.action.label}</summary>
                        <span className="text-ink-muted">{r.log || "sem detalhes"}</span>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs text-ink-muted">
          <span>{countLine(rows.length, total, since)}</span>
          {pages > 1 && (
            <span className="flex gap-3">
              {filters.page > 1 && <Link href={href({ pagina: String(filters.page - 1) })}>anteriores</Link>}
              <span>
                {filters.page} de {pages}
              </span>
              {filters.page < pages && <Link href={href({ pagina: String(filters.page + 1) })}>mais antigas</Link>}
            </span>
          )}
        </div>
      </section>

      <div className="flex flex-wrap gap-2.5">
        {/* C10 (module 3) is wave 3. */}
        <span aria-disabled="true" className={`${BUTTON_SECONDARY} cursor-default text-ink-faint`}>
          Notas de compra (módulo 3)
        </span>
        <Link href={`/console/contas/${account.code}/estrutura`} className={BUTTON_SECONDARY}>
          Estrutura do cliente
        </Link>
      </div>
    </ConsoleMain>
  );
}
