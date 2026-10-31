// P03 / W07 Conectar os apps (design/P03-Autorizar.dc.html phone, design/W07-Autorizar.dc.html computer;
// 05 §B, 06 §1, §9, D21, D48). Flags m2.ifood_api (step 1) and m2.extensao_chrome (step 2): the page shows
// when either is on. Dono and Financeiro see it; only the Dono accepts the terms (decision in the report).
import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CARD, DeskFictitious, DeskTitle, Notice, PHONE_PRIMARY, PortalMain } from "@/components/portal";
import { isEnabled } from "@/lib/flags";
import { appOrigin, requirePortal } from "@/lib/portal/account-access";
import { loadConnect, PARTNER_PORTAL_URL } from "@/lib/portal/connect";
import { whatsappShareLink } from "@/lib/portal/scope";
import { adminClient } from "@/lib/supabase/admin";
import { acceptTermsAction } from "./actions";

export const metadata = { title: "Conectar os apps · MargoAI" };

const OUTLINE = "inline-flex min-h-11 items-center justify-center rounded-md border border-ink font-semibold no-underline";
const DARK = "inline-flex min-h-11 items-center justify-center rounded-md bg-ink font-semibold text-ink-inverse no-underline hover:text-ink-inverse";

/** The Chrome Web Store listing is unlisted and not published yet (06 §9); set by the platform when it is. */
const webStoreUrl = () => process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL || null;

export default async function ConectarPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const flags = ["m2.ifood_api", "m2.extensao_chrome"] as const;
  const m = await requirePortal({ roles: ["dono", "financeiro"], flags });
  const q = await searchParams;
  const [ifoodOn, extOn, v] = await Promise.all([isEnabled("m2.ifood_api", m.account.id), isEnabled("m2.extensao_chrome", m.account.id), loadConnect(adminClient(), m.account.id)]);
  const dono = m.role === "dono";
  const pending = dono && v.pending.length > 0;
  const store = webStoreUrl();
  const share = whatsappShareLink(null, `Abra no Chrome do computador para instalar a extensão da MargoAI: ${await appOrigin()}/app/conectar`);

  return (
    <PortalMain>
      {ifoodOn && !v.ifood.done && <AutoRefresh />}
      <Notice text={q.aviso} />
      <h1 className="m-0 text-[26px] leading-tight md:hidden">Conectar o iFood da {m.account.name}</h1>
      <DeskTitle title="Conectar os apps" lead="Dois passos. Nenhum pede sua senha.">
        <DeskFictitious synthetic={m.account.isSynthetic} />
      </DeskTitle>

      <div className="flex flex-col gap-2 rounded-lg bg-ok-bg p-3.5 text-md leading-normal md:hidden">
        <b>O que a gente lê</b>
        <span>Vendas, taxas, promoções e repasses dos últimos 3 meses.</span>
      </div>
      <div className="flex flex-col gap-2 rounded-lg bg-bg p-3.5 text-md leading-normal md:hidden">
        <b>O que a gente nunca faz</b>
        <span>Não pedimos sua senha. Não mexemos em preço, cardápio ou promoção. Você cancela quando quiser no próprio iFood.</span>
      </div>

      <div className="flex flex-wrap items-stretch gap-5">
        {ifoodOn && (
          <section className={`${CARD} flex min-w-0 flex-[1_1_420px] flex-col gap-3 p-5`} data-step="ifood">
            <div className="flex items-center justify-between">
              <b className="text-lg">1. Autorizar no iFood</b>
              <span className={`rounded-full px-2.5 py-0.75 text-xs ${v.ifood.done ? "bg-ok-bg text-ok" : "bg-warn-bg"}`} data-ifood-status>
                {v.ifood.label}
              </span>
            </div>
            <ol className="m-0 flex flex-col gap-2 pl-5 text-base leading-snug">
              {pending && <li>Aceite os termos abaixo.</li>}
              <li>Entre no Portal do Parceiro com o login de dono.</li>
              <li>
                Em Aplicativos, clique em <b>Permitir</b> ao lado de MargoAI.
              </li>
              <li className="hidden md:list-item">Volte aqui: suas lojas aparecem sozinhas.</li>
            </ol>
            <div className="hidden text-sm leading-normal text-ink-muted md:block">
              Lemos vendas, taxas, promoções e repasses. Não mexemos em preço nem em cardápio. <Link href="/termos">Termos</Link>
            </div>
            {pending ? (
              <form action={acceptTermsAction} className="flex flex-col gap-3" data-terms-form>
                {v.pending.length > 1 &&
                  v.pending.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-md">
                      <input type="checkbox" name="cnpj" value={c.id} defaultChecked className="h-4.5 w-4.5" /> {c.label}
                    </label>
                  ))}
                {v.pending.length === 1 && <input type="hidden" name="cnpj" value={v.pending[0].id} />}
                <label className="flex items-start gap-2.5 text-md leading-normal">
                  <input type="checkbox" name="autorizo" required className="mt-0.75 h-4.5 w-4.5" />
                  <span>
                    Autorizo a MargoAI a ler esses dados, inclusive com ferramentas de IA, para calcular meu lucro. <Link href="/termos">Ler os termos</Link>
                  </span>
                </label>
                <button type="submit" className={`${PHONE_PRIMARY} cursor-pointer border-0 text-base`}>
                  Abrir o Portal do Parceiro
                </button>
              </form>
            ) : (
              <a href={PARTNER_PORTAL_URL} target="_blank" rel="noreferrer" className={`${PHONE_PRIMARY} md:hidden`}>
                Abrir o Portal do Parceiro
              </a>
            )}
            <Link href="/app/lojas" className={`${OUTLINE} mt-auto hidden md:inline-flex`}>
              Ver as lojas encontradas
            </Link>
          </section>
        )}
        {extOn && (
          <section className={`${CARD} hidden min-w-0 flex-[1_1_420px] flex-col gap-3 p-5 md:flex`} data-step="extensao">
            <div className="flex items-center justify-between">
              <b className="text-lg">2. Instalar a extensão do Chrome</b>
              <span className="rounded-full bg-warn-bg px-2.5 py-0.75 text-xs">neste computador</span>
            </div>
            <div className="text-base leading-normal">Para o que a API do iFood não entrega, como vendas por item. Ela roda só no Chrome do computador, enquanto o Portal do Parceiro estiver aberto.</div>
            <div className="flex items-center gap-3 rounded-md bg-bg p-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-ink font-extrabold text-ink-inverse">M</span>
              <span className="text-md leading-snug">
                <b>MargoAI para o Portal do Parceiro</b>
                <br />
                <span className="text-ink-muted">Chrome Web Store · lê só a página aberta</span>
              </span>
            </div>
            {store ? (
              <a href={store} target="_blank" rel="noreferrer" className={`${DARK} mt-auto`}>
                Adicionar ao Chrome
              </a>
            ) : (
              <span aria-disabled="true" className={`${DARK} mt-auto opacity-50`}>
                Adicionar ao Chrome
              </span>
            )}
            <div className="text-sm text-ink-muted">Está no celular? Mandamos este link por WhatsApp para abrir no computador.</div>
          </section>
        )}
      </div>

      {extOn && (
        <div className="flex flex-col gap-1.5 text-center md:hidden">
          <a href={share} target="_blank" rel="noreferrer" className="text-md">
            Mandar o link da extensão para abrir no computador
          </a>
          <div className="text-xs text-ink-muted">A extensão do Chrome só funciona no computador.</div>
        </div>
      )}
      <div className="mt-auto text-xs leading-normal text-ink-muted md:hidden">Página da MargoAI aberta pelo link do WhatsApp. O Portal do Parceiro é do iFood; a autorização fica registrada lá.</div>
    </PortalMain>
  );
}
