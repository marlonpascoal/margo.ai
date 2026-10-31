// C18 Parceiros BPO (design/C18-BPO.dc.html, 05 §A). Fundador and Operação; the price column is Fundador only
// (04 §5). Flag bpo.marca_propria: shown while it is on for some BPO client (A05: otherwise 404).
import Link from "next/link";
import { notFound } from "next/navigation";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ConsoleMain, FictitiousLabel, PageTitle } from "@/components/console";
import { bpoScreenEnabled, loadBrandedCloses, loadPartners } from "@/lib/console/bpo";
import { requireConsole } from "@/lib/console/staff";
import { canConsole } from "@/lib/permissions";
import { adminClient } from "@/lib/supabase/admin";
import { generateBrandedAction, saveBrandAction } from "./actions";

export const metadata = { title: "Parceiros BPO · MargoAI" };

const th = "border-b border-border px-3.5 py-3 font-normal";
const td = "border-b border-border-subtle px-3.5 py-3";

export default async function BpoPage({ searchParams }: { searchParams: Promise<{ bpo?: string; aviso?: string }> }) {
  const staff = await requireConsole("clients");
  const q = await searchParams;
  const db = adminClient();
  const partners = await loadPartners(db);
  if (!(await bpoScreenEnabled(partners))) notFound();
  const showPrice = canConsole(staff.role, "billing");
  const selected = partners.find((p) => p.record.id === q.bpo) ?? partners[0];
  const synthetic = partners.some((p) => p.clients.some((c) => c.synthetic));
  const closes = selected ? await loadBrandedCloses(db, selected.record.id) : [];
  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C18"
          kicker="C18 · Clientes e cobrança · piloto E8"
          title="Parceiros BPO"
          lead="O BPO entrega o fechamento com a marca dele. Ele põe os arquivos numa pasta compartilhada; a gente devolve o PDF na mesma pasta."
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {synthetic && <FictitiousLabel />}
          {selected && (
            <form action={generateBrandedAction}>
              <input type="hidden" name="bpo" value={selected.record.id} />
              <button type="submit" className={BUTTON_PRIMARY}>
                Gerar fechamento com a marca do BPO
              </button>
            </form>
          )}
        </div>
      </div>
      {q.aviso && (
        <p role="status" className="m-0 rounded-md bg-ok-bg px-3 py-2 text-md">
          {q.aviso}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[3_1_520px] overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-md">
            <thead>
              <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                <th className={th}>BPO</th>
                <th className={th}>Clientes no piloto</th>
                <th className={th}>Pasta</th>
                {showPrice && <th className={th}>Preço por loja</th>}
              </tr>
            </thead>
            <tbody>
              {partners.map(({ row }) => (
                <tr key={row.id} data-bpo={row.name} aria-selected={row.id === selected?.record.id}>
                  <td className={`${td} font-semibold`}>
                    <Link href={`/console/bpo?bpo=${row.id}`} className="no-underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className={td}>{row.clients}</td>
                  <td className={`${td} ${row.folder.ok ? "text-ok" : "text-ink-muted"}`}>{row.folder.text}</td>
                  {showPrice && <td className={`${td} font-mono`}>{row.price}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected && (
          <form action={saveBrandAction} className="flex min-w-0 flex-[2_1_320px] flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <input type="hidden" name="bpo" value={selected.record.id} />
            <b>Marca do {selected.record.name} no fechamento</b>
            <label htmlFor="logo" className="flex min-h-16 items-center justify-center rounded-md border border-dashed border-border-strong text-sm text-ink-muted">
              {selected.record.logo_path ? `Logo do BPO (PNG ou SVG): ${selected.record.logo_path.split("/").pop()}` : "Logo do BPO (PNG ou SVG)"}
            </label>
            <input id="logo" name="logo" type="file" accept=".png,.svg,image/png,image/svg+xml" className="text-xs" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cor" className="text-sm text-ink-muted">
                Cor principal
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="cor"
                  name="cor"
                  defaultValue={selected.record.primary_color ?? ""}
                  className="min-h-10 min-w-0 flex-1 rounded-sm border border-border-strong px-2.5 font-mono"
                />
                {/* The partner's own color is data, shown as saved. */}
                {selected.record.primary_color && <span aria-hidden className="size-10 rounded-sm border border-border" style={{ background: selected.record.primary_color }} />}
              </div>
            </div>
            <label className="flex items-center gap-2.5 text-md">
              <input type="checkbox" name="rodape" defaultChecked={selected.record.show_powered_by} /> Mostrar &quot;com tecnologia MargoAI&quot; no rodapé
            </label>
            <button type="submit" className={`${BUTTON_SECONDARY} self-start`}>
              Salvar marca
            </button>
          </form>
        )}
      </div>
      {closes.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="branded">
          <h2 id="branded" className="m-0 text-lg font-bold">
            Fechamentos com a marca do {selected!.record.name}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-md">
            {closes.map((c) => (
              <li key={c.jobId} className="flex gap-3">
                <span>
                  {c.account} · {c.month}
                </span>
                {c.ready ? <a href={`/console/bpo/pdf/${c.jobId}`}>baixar PDF</a> : <span className="text-ink-muted">{c.status}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </ConsoleMain>
  );
}
