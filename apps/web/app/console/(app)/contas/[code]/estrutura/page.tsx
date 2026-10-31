// C19 Estrutura do cliente (design/C19-Estrutura.dc.html, 05 §A, D29). Fundador and Operação. Conta, CNPJ,
// cozinha, loja em cada app; only linked stores count for close and billing.
import { ConsoleMain, FictitiousLabel, PageTitle, Pill } from "@/components/console";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode } from "@/lib/m2/account";
import { loadStructure, structureRows } from "@/lib/m2/structure";
import { adminClient } from "@/lib/supabase/admin";
import { linkStoreAction } from "./actions";

export const metadata = { title: "Estrutura do cliente · MargoAI" };

const th = "border-b border-border px-3.5 py-3 font-normal";
const td = "border-b border-border-subtle px-3.5 py-2.5";

export default async function StructurePage({ params }: { params: Promise<{ code: string }> }) {
  await requireConsole("clients");
  const { code } = await params;
  const db = adminClient();
  const account = await accountByCode(db, code);
  const { records, kitchens, brands, counts } = await loadStructure(db, account);
  const rows = structureRows(records, new Date());
  const kpis = [
    { n: counts.companies, label: "CNPJs" },
    { n: counts.kitchens, label: `cozinhas (${counts.billed} cobradas)` },
    { n: counts.brands, label: "marcas" },
    { n: counts.stores, label: "lojas de canal" },
  ];

  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          code="C19"
          kicker={`C19 · Clientes e cobrança · ${account.name} (${account.code})`}
          title="Estrutura do cliente"
          lead="Conta, depois CNPJ, depois cozinha, depois loja em cada app. A loja de canal é o mesmo objeto que o iFood chama de merchant. No iFood, cada loja tem URL própria, e o código no fim da URL identifica a loja: é por ele que o raio-X público e a API autorizada se encontram."
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {account.isSynthetic && <FictitiousLabel />}
          {/* The merchant list comes from the iFood API adapter (C05), which waits for the developer account. */}
          <button type="button" disabled className="inline-flex min-h-11 cursor-not-allowed items-center rounded-md border border-border-strong bg-surface px-4.5 text-base text-ink-faint">
            Buscar lojas no iFood de novo
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3.5">
            <div className="font-mono text-2xl">{k.n}</div>
            <div className="text-sm text-ink-muted">{k.label}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[900px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              {["CNPJ", "Cozinha", "Marca", "App", "Id no app e URL pública", "Fonte", "Vínculo"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-store={r.externalId}>
                <td className={`${td} font-mono text-xs`}>{r.cnpj}</td>
                <td className={td}>{r.kitchen}</td>
                <td className={td}>{r.brand}</td>
                <td className={td}>{r.app}</td>
                <td className={`${td} font-mono text-xs`}>
                  {r.externalId}
                  <br />
                  <span className="text-ink-muted">{r.url}</span>
                </td>
                <td className={`${td} text-sm`}>{r.source}</td>
                <td className={td}>
                  <Pill tone={r.tone === "ok" ? "ok" : r.tone === "pend" ? "warn" : "run"}>{r.link}</Pill>
                  {r.needsLink && (
                    <form action={linkStoreAction} className="mt-2 flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="conta" value={account.code} />
                      <input type="hidden" name="loja" value={r.id} />
                      <select name="cozinha" aria-label="Cozinha" required className="min-h-8 rounded-sm border border-border-strong bg-surface px-1.5 text-xs">
                        {kitchens.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.name}
                          </option>
                        ))}
                      </select>
                      <select name="marca" aria-label="Marca" className="min-h-8 rounded-sm border border-border-strong bg-surface px-1.5 text-xs">
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="min-h-8 cursor-pointer rounded-sm border border-border-strong bg-surface px-2 text-xs text-ink">
                        vincular
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-sm text-ink-muted">Uma loja nova no iFood entra como &quot;sem cozinha&quot; até alguém vincular. O fechamento e a cobrança só contam lojas com vínculo.</p>
    </ConsoleMain>
  );
}
