// P07 Criar conta (on computer it is also the Criar conta tab of W06). ?ref=<xray> comes from the P02
// WhatsApp link and ties the X-ray's public store to the new kitchen (05 P07).
import Link from "next/link";
import SignUpForm from "@/components/portal/SignUpForm";
import { trialDays } from "@/lib/portal/entry";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar conta · MargoAI" };

export default async function CriarContaPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  const days = await trialDays(adminClient());
  return (
    <div className="flex min-h-screen justify-center bg-surface text-ink md:bg-bg md:py-10">
      <div className="box-border flex w-full max-w-[440px] flex-col gap-4 px-5 py-6 md:rounded-2xl md:border md:border-border md:bg-surface md:p-8">
        <div className="text-base font-extrabold">MargoAI</div>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[26px] leading-[1.2]">Crie sua conta</h1>
          <p className="m-0 text-base leading-normal text-ink-2">{days} dias grátis para ver o lucro por canal. Sem cartão agora.</p>
        </div>
        <SignUpForm variant="phone" trialDays={days} xrayRef={typeof ref === "string" ? ref : null} />
        <Link href="/entrar" className="text-center text-md">
          Já tenho conta: entrar
        </Link>
        <div className="text-sm leading-normal text-ink-muted">
          Entramos com um código no seu e-mail, sem senha. No fim do teste você escolhe um plano, ou a conta volta para o raio-X grátis.
        </div>
      </div>
    </div>
  );
}
