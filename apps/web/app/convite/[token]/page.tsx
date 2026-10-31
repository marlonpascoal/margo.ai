// P18 Aceitar convite (04 §8): who invited, profile, kitchens, what the profile sees. A token that is
// unknown, used or past its 7 days shows one clear message and nothing about the account.
import AcceptForm from "@/components/portal/AcceptForm";
import { ENTRY_MESSAGES, inviteView, PROFILE_LABEL } from "@/lib/portal/entry";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aceitar convite · MargoAI", referrer: "no-referrer" };

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await inviteView(adminClient(), token);
  return (
    <div className="flex min-h-screen justify-center bg-surface text-ink md:bg-bg md:py-10">
      <div className="box-border flex w-full max-w-[440px] flex-col gap-4 px-5 py-7 md:rounded-2xl md:border md:border-border md:bg-surface md:p-8">
        <div className="text-base font-extrabold">MargoAI</div>
        {!v ? (
          <>
            <h1 className="m-0 text-2xl leading-[1.25]">Convite inválido</h1>
            <p className="m-0 text-base leading-normal text-ink-2">{ENTRY_MESSAGES.inviteInvalid}</p>
          </>
        ) : (
          <>
            <h1 className="m-0 text-2xl leading-[1.25]">
              {v.inviter} convidou você para o {v.accountName}
            </h1>
            <div className="flex flex-col gap-2 rounded-xl bg-bg p-3.5 text-md leading-normal">
              <span>
                Perfil: <b>{PROFILE_LABEL[v.role]}</b>
              </span>
              <span>
                Cozinhas: <b>{v.kitchens}</b>
              </span>
              <span className="text-ink-2">{v.sees}</span>
            </div>
            <AcceptForm token={token} askEmail={v.channel === "whatsapp"} />
            <div className="mt-auto text-xs leading-normal text-ink-muted">
              {v.sentTo} Vale por 7 dias. Não conhece quem convidou? Ignore esta mensagem.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
