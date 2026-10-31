// W09 Segurança e acesso (phone: reached from P08). Devices and "Sair de todos os aparelhos" for everyone;
// the access log for the Dono (04 §5, audit_log RLS). Changing a contact (E04), the data export and the
// account deletion (E06) are drawn here and not built in this task: their buttons stay disabled.
import Link from "next/link";
import SignOutAll from "@/components/portal/SignOutAll";
import { canPortal } from "@/lib/permissions";
import { maskWhatsapp } from "@/lib/portal/format";
import { loadAccessLog, loadDevices } from "@/lib/portal/security";
import { requireMember } from "@/lib/portal/session";
import { adminClient } from "@/lib/supabase/admin";
import { signOutDevice } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Segurança e acesso · MargoAI" };

const card = "flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4.5";
const line = "flex justify-between gap-3 border-t border-border-subtle py-2.5 text-md";
const small = "min-h-9 cursor-pointer rounded-sm border border-border-strong bg-surface px-3 text-sm text-ink disabled:cursor-default disabled:opacity-60";

export default async function SegurancaPage() {
  const m = await requireMember();
  const db = adminClient();
  const dono = canPortal(m.role, "people");
  const [devices, log] = await Promise.all([loadDevices(db, m.personId, m.sessionDeviceId), dono ? loadAccessLog(db, m.account.id, m.personId) : Promise.resolve([])]);
  return (
    <main className="mx-auto box-border flex max-w-[1180px] flex-col gap-5 px-4 py-5 md:px-8 md:py-7">
      <Link href="/app" className="text-md md:hidden">
        Minha conta
      </Link>
      <h1 className="m-0 text-2xl md:text-4xl">Segurança e acesso</h1>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-4">
        <section className={`${card} gap-3`}>
          <b>Como você entra</b>
          {m.email && (
            <div className={line}>
              <span>E-mail: {m.email}</span>
              <button type="button" disabled className={small}>
                Trocar
              </button>
            </div>
          )}
          {m.whatsappE164 && (
            <div className={line}>
              <span>WhatsApp: {maskWhatsapp(m.whatsappE164)}</span>
              <button type="button" disabled className={small}>
                Trocar
              </button>
            </div>
          )}
          <div className="text-sm leading-normal text-ink-muted">
            Para trocar, confirmamos com um código no canal novo e avisamos o antigo. Sem senha para lembrar ou recuperar.
          </div>
        </section>
        <section className={card}>
          <b>Aparelhos conectados</b>
          {devices.map((d) => (
            <div key={d.ids[0]} className={line}>
              <span>
                {d.name}
                <br />
                <span className="text-xs text-ink-muted">{d.where}</span>
              </span>
              {d.current ? (
                <button type="button" disabled className={small}>
                  Este
                </button>
              ) : (
                <form action={signOutDevice}>
                  <input type="hidden" name="ids" value={d.ids.join(",")} />
                  <button type="submit" className={small} aria-label={`Sair do ${d.name}`}>
                    Sair
                  </button>
                </form>
              )}
            </div>
          ))}
          <SignOutAll />
        </section>
        {dono && (
          <section className={card}>
            <b>Registro de acesso</b>
            {log.map((l, i) => (
              <div key={i} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2.5 border-t border-border-subtle py-2 text-sm">
                <span className="font-mono text-ink-muted">{l.when}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </section>
        )}
        <section id="dados" className={card}>
          <b>Seus dados</b>
          <div className="text-md leading-normal">
            Revogar o acesso ao iFood: no Portal do Parceiro, em Aplicativos. Os dados que já temos ficam até você pedir para apagar.
          </div>
          <button type="button" disabled className="min-h-10 rounded-md border border-border-strong bg-surface text-md text-ink disabled:opacity-60">
            Baixar todos os meus dados
          </button>
          {canPortal(m.role, "delete_account") && (
            <>
              <button type="button" disabled className="min-h-10 rounded-md border border-danger bg-surface text-md text-danger disabled:opacity-60">
                Excluir a conta e os dados
              </button>
              <div className="text-xs text-ink-muted">Excluir pede confirmação com código e apaga tudo em até 90 dias. Só o Dono pode.</div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
