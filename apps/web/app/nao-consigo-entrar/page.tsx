// P17 Não consigo entrar (04 §8): no password to recover; each case leads to P15, W09 or the founders.
import Link from "next/link";
import VerificationForm from "@/components/portal/VerificationForm";

export const metadata = { title: "Não consigo entrar · MargoAI" };

const OPTIONS: { t: string; d: string; href: string }[] = [
  { t: "O código não chegou", d: "Mandar de novo, ou pelo outro canal (e-mail em vez de WhatsApp, ou o contrário).", href: "/entrar" },
  { t: "Troquei de número de WhatsApp", d: "Entre pelo e-mail e troque o número em Segurança. O número antigo deixa de funcionar.", href: "/app/seguranca" },
  {
    t: "Perdi o acesso ao e-mail e ao WhatsApp",
    d: "Outro Dono da conta pode te convidar de novo. Se você é o único Dono, a equipe da MargoAI confere pelo CNPJ e pelo contrato social.",
    href: "#verificar",
  },
  { t: "Alguém entrou na minha conta", d: "Sair de todos os aparelhos agora e avisar a equipe.", href: "/app/seguranca" },
];

export default function NaoConsigoEntrarPage() {
  return (
    <div className="flex min-h-screen justify-center bg-surface text-ink md:bg-bg md:py-10">
      <div className="box-border flex w-full max-w-[440px] flex-col gap-3.5 px-5 py-7 md:rounded-2xl md:border md:border-border md:bg-surface md:p-8">
        <Link href="/entrar" className="text-md">
          Voltar para Entrar
        </Link>
        <h1 className="m-0 text-2xl">Não consigo entrar</h1>
        <p className="m-0 text-base leading-normal text-ink-2">Como o acesso é sem senha, não existe senha para recuperar. Escolha o que aconteceu:</p>
        {OPTIONS.map((o) => (
          <Link key={o.t} href={o.href} className="flex flex-col gap-1 rounded-xl border border-border p-3.5 no-underline">
            <b className="text-base">{o.t}</b>
            <span className="text-sm leading-[1.45] text-ink-2">{o.d}</span>
          </Link>
        ))}
        <section id="verificar" aria-labelledby="verificar-h" className="flex scroll-mt-4 flex-col gap-3 rounded-xl bg-bg p-3.5">
          <h2 id="verificar-h" className="m-0 text-base">
            Pedir verificação pela equipe
          </h2>
          <VerificationForm />
        </section>
        <div className="mt-auto text-xs leading-normal text-ink-muted">
          Por segurança, toda troca de e-mail ou WhatsApp avisa o canal antigo, e a conta fica 24 horas sem poder mudar plano ou pessoas.
        </div>
      </div>
    </div>
  );
}
