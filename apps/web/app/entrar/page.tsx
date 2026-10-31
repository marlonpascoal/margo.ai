// P15 Entrar (phone) and W06 Entrar ou criar conta (computer), one responsive page (D32).
// Codes by e-mail (04 §8); the same answer for every address, so the form never says who has access.
import Link from "next/link";
import { redirect } from "next/navigation";
import EntrarPanel from "@/components/portal/EntrarPanel";
import { isEnabled } from "@/lib/flags";
import { trialDays } from "@/lib/portal/entry";
import { portalPersonId } from "@/lib/portal/session";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar · MargoAI" };

export default async function EntrarPage() {
  if (await portalPersonId()) redirect("/app");
  const [whatsapp, days] = await Promise.all([isEnabled("auth.whatsapp_code", null), trialDays(adminClient())]);
  return (
    <div className="flex min-h-screen flex-wrap bg-surface text-ink md:bg-bg">
      <section className="box-border hidden min-w-0 flex-[1_1_480px] flex-col justify-center gap-5 bg-ink p-14 text-bg md:flex">
        <b className="text-xl">MargoAI</b>
        <h1 className="m-0 max-w-[520px] text-[40px] leading-[1.15]">Quanto sobra de cada pedido, por cozinha e por app.</h1>
        <p className="m-0 max-w-[520px] text-[17px] leading-[1.55] text-border">
          Fechamento do mês, o que os apps cobraram errado e o custo de cada prato a partir das suas notas.
        </p>
      </section>
      <section className="box-border flex min-h-screen min-w-0 flex-[1_1_420px] flex-col gap-4.5 px-5 py-7 md:min-h-0 md:justify-center md:gap-5 md:p-14">
        <div className="text-base font-extrabold md:hidden">MargoAI</div>
        <h1 className="m-0 text-[26px] md:hidden">Entrar</h1>
        <EntrarPanel whatsapp={whatsapp} trialDays={days} />
        <div className="mt-auto flex max-w-[420px] flex-col gap-2 text-md md:mt-0">
          <span className="md:hidden">
            Ainda não tem conta? <Link href="/criar-conta">Criar conta grátis</Link>
          </span>
          <Link href="/nao-consigo-entrar">Não consigo entrar</Link>
          <span className="text-xs leading-normal text-ink-muted">
            Sem senha. Se você tem mais de um grupo, escolhe qual abrir depois de entrar. No computador, a sessão dura 30 dias; dá para sair de todos os
            aparelhos em Minha conta.
          </span>
        </div>
      </section>
    </div>
  );
}
