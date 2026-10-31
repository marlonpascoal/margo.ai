// P11 Termos e privacidade (public). The summary as drawn; the full text is docs/legal/ after the legal
// review (D48), so "Texto completo" stays a placeholder until then.
import Link from "next/link";

export const metadata = { title: "Termos e privacidade · MargoAI" };

const ITEMS: [string, string][] = [
  ["O que lemos", "Vendas, taxas, promoções e repasses dos apps; notas de compra que você ou seu contador mandarem."],
  ["Para quê", "Calcular o que sobra por item e por canal, e achar valores cobrados errado."],
  ["Quem processa", "A MargoAI, inclusive com ferramentas de IA. Seus dados não vão para o iFood nem para outro restaurante."],
  ["Por quanto tempo", "Enquanto a conta existir. Se você sair, apagamos em até 90 dias."],
  ["Como revogar", "No Portal do Parceiro do iFood, em Aplicativos. Ou em Minha conta."],
  ["Como apagar tudo", "Em Minha conta, Excluir meus dados."],
];

const btn = "flex min-h-11 flex-1 items-center justify-center rounded-md border border-border-strong text-md no-underline";

export default function TermosPage() {
  return (
    <div className="flex min-h-screen justify-center bg-surface text-ink md:bg-bg md:py-10">
      <div className="box-border flex w-full max-w-[560px] flex-col gap-3.5 px-5 py-6 md:rounded-2xl md:border md:border-border md:bg-surface md:p-8">
        <div className="text-base font-extrabold">MargoAI</div>
        <h1 className="m-0 text-2xl leading-[1.2]">Termos e privacidade, em resumo</h1>
        <div className="text-xs text-ink-muted">Resumo de exemplo. O texto final passa pela consulta jurídica.</div>
        {ITEMS.map(([t, d]) => (
          <div key={t} className="flex flex-col gap-0.5 border-b border-border-subtle pb-2.5">
            <b className="text-md">{t}</b>
            <span className="text-md leading-[1.45] text-ink-2">{d}</span>
          </div>
        ))}
        <div className="mt-auto flex gap-2.5 pt-2">
          <Link href="/app" className={btn}>
            Minha conta
          </Link>
          <a href="#completo" aria-disabled="true" className={btn}>
            Texto completo
          </a>
        </div>
        <p id="completo" className="m-0 text-xs text-ink-muted">
          O texto completo entra aqui depois da consulta jurídica.
        </p>
      </div>
    </div>
  );
}
