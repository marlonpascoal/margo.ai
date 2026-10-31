// C10 Notas de compra (design/C10-Notas.dc.html, 05 §A, 06 §5, D11, D13). Fundador and Operação.
// Flag m3.notas_xml. "Pedir nota pelo WhatsApp" opens click-to-chat with the P05 text (missing top-20 only).
import Link from "next/link";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ConsoleMain, FictitiousLabel, PageTitle } from "@/components/console";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode } from "@/lib/m2/account";
import { brlCents } from "@/lib/m2/format";
import { topIngredients } from "@/lib/m3/coverage";
import { coverage, keyedReceipts, latestImport, missingLine, zipStatsLines } from "@/lib/m3/notas";
import { adminClient } from "@/lib/supabase/admin";
import { addLineAction, saveKeyAction, uploadZipAction } from "./actions";

export const metadata = { title: "Notas de compra · MargoAI" };

const card = "flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4";
const field = "min-h-9 rounded-sm border border-border-strong bg-surface px-2 text-sm";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export default async function NotasPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ aviso?: string; nota?: string }> }) {
  await requireConsole("clients");
  const { code } = await params;
  const q = await searchParams;
  const db = adminClient();
  const account = await accountByCode(db, code);
  await requireFlag("m3.notas_xml", account.id);
  const [run, top, receipts] = await Promise.all([latestImport(db, account.id), topIngredients(db, account.id, today()), keyedReceipts(db, account.id)]);
  const cov = coverage(top);
  const stats = zipStatsLines(run);
  const open = receipts.find((r) => r.id === q.nota) ?? receipts.find((r) => r.lines.length === 0);

  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle code="C10" kicker={`C10 · Módulo 3 · ${account.name}`} title="Notas de compra" lead="Para o preço, basta uma nota por insumo. Não precisamos de todas." />
        <div className="flex flex-wrap items-center gap-2.5">
          {account.isSynthetic && <FictitiousLabel />}
          <Link href={`/console/contas/${account.code}/de-para`} className={BUTTON_PRIMARY}>
            Mapear insumos
          </Link>
        </div>
      </div>

      {q.aviso && (
        <p role="status" className="m-0 rounded-md border border-warn-border bg-warn-bg px-4 py-3 text-md">
          {q.aviso}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
          <section className={card}>
            <b>Pasta do contador</b>
            <form action={uploadZipAction} className="flex flex-col gap-2.5">
              <input type="hidden" name="conta" value={account.code} />
              <label htmlFor="zip" className="flex min-h-18 items-center justify-center rounded-md border border-dashed border-border-strong p-2 text-center text-sm text-ink-muted">
                Arraste o .zip com os XMLs de compra
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input id="zip" name="zip" type="file" accept=".zip" className="min-w-0 flex-1 text-xs" />
                <button type="submit" className="min-h-9 cursor-pointer rounded-sm border border-border-strong bg-surface px-3 text-sm text-ink">
                  Importar
                </button>
              </div>
            </form>
            <div className="font-mono text-md leading-[1.7]" data-zip-stats>
              {stats.map((s, i) => (
                <div key={i}>{s}</div>
              ))}
            </div>
          </section>

          <section className={card}>
            <b>Cupom avulso</b>
            <form action={saveKeyAction} className="flex flex-col gap-2.5">
              <input type="hidden" name="conta" value={account.code} />
              <label htmlFor="chave" className="text-sm text-ink-muted">
                Chave de 44 dígitos ou link do QR code
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="chave"
                  name="chave"
                  placeholder="4126 1012 3456 7800 0190 6500 1000 0012 3412 3456 7890"
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-border-strong px-3 font-mono text-xs"
                />
                <button type="submit" className="min-h-11 cursor-pointer rounded-md border border-border-strong bg-surface px-3 text-sm text-ink">
                  Salvar
                </button>
              </div>
            </form>
            <div className="text-xs text-ink-muted">Dígito verificador conferido antes de salvar. Itens digitados a partir da página pública da SEFAZ.</div>
            {open && (
              <div className="flex flex-col gap-2 border-t border-border-subtle pt-2.5" data-receipt={open.key}>
                <div className="font-mono text-xs break-all">
                  {open.model === 65 ? "NFC-e" : "NF-e"} {open.key}
                </div>
                {open.lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-2 text-sm">
                    <span>{l.description}</span>
                    <span className="font-mono whitespace-nowrap">{brlCents(l.total_cents)}</span>
                  </div>
                ))}
                <form action={addLineAction} className="grid grid-cols-2 gap-1.5">
                  <input type="hidden" name="conta" value={account.code} />
                  <input type="hidden" name="nota" value={open.id} />
                  <input name="data" type="date" aria-label="Data da nota" defaultValue={open.issuedOn} className={`${field} col-span-2`} />
                  <input name="descricao" aria-label="Descrição do item" placeholder="descrição como na nota" className={`${field} col-span-2`} />
                  <input name="unidade" aria-label="Unidade" placeholder="unidade (KG, UN)" className={field} />
                  <input name="quantidade" aria-label="Quantidade" placeholder="quantidade" className={field} />
                  <input name="valor" aria-label="Valor do item" placeholder="valor do item, R$" className={field} />
                  <button type="submit" className="min-h-9 cursor-pointer rounded-sm border border-border-strong bg-surface px-3 text-sm text-ink">
                    Adicionar item
                  </button>
                </form>
              </div>
            )}
          </section>
        </div>

        <section className="flex min-w-0 flex-[2_1_460px] flex-col rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5">
            <b>Cobertura dos 20 insumos que mais pesam</b>
            <span className="font-mono text-lg text-ok" data-coverage>
              {cov.covered} de {cov.total}
            </span>
          </div>
          {cov.rows.map((r) => (
            <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1fr)_120px_150px] items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-md" data-ingredient={r.name}>
              <span>{r.name}</span>
              <span className="text-right font-mono">{r.price}</span>
              <span className={`text-xs ${r.covered ? "text-ok" : "text-danger"}`}>{r.source}</span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
            <span className="text-md">{missingLine(cov.missing.length)}</span>
            {cov.whatsapp && (
              <a href={cov.whatsapp} target="_blank" rel="noreferrer" className={BUTTON_SECONDARY}>
                Pedir nota pelo WhatsApp
              </a>
            )}
          </div>
        </section>
      </div>
    </ConsoleMain>
  );
}
