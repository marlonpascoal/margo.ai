// P16 Notificações (phone) and W08 (computer), one route. Each person chooses what they receive and where
// (04 §9, E05); billing and security notices always go by e-mail; no WhatsApp between 22h and 8h.
import Link from "next/link";
import PrefToggle from "@/components/portal/PrefToggle";
import { maskWhatsapp } from "@/lib/portal/format";
import { loadNoticeRows } from "@/lib/portal/notices";
import { requireMember } from "@/lib/portal/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notificações · MargoAI" };

export default async function NotificacoesPage() {
  const m = await requireMember();
  const rows = await loadNoticeRows(m.db, m.personId, m.account.id, m.role);
  const td = "border-b border-border-subtle px-3.5 py-2.75";
  return (
    <>
      {/* P16, phone */}
      <main className="box-border flex flex-col gap-2.5 px-3.5 py-4.5 md:hidden">
        <Link href="/app" className="text-md">
          Minha conta
        </Link>
        <h1 className="m-0 text-[22px]">Notificações</h1>
        <div className="grid grid-cols-[minmax(0,1fr)_56px_64px] gap-1.5 px-3 text-2xs text-ink-muted uppercase">
          <span>Aviso</span>
          <span className="text-center">E-mail</span>
          <span className="text-center">WhatsApp</span>
        </div>
        {rows.map((r) => (
          <div key={r.code} className="grid grid-cols-[minmax(0,1fr)_56px_64px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-md">
            <span className="leading-[1.3]">{r.phoneName}</span>
            <span className="justify-self-center">
              <PrefToggle code={r.code} channel="email" name={r.phoneName} checked={r.email} locked={r.locked} size="lg" />
            </span>
            <span className="justify-self-center">
              <PrefToggle code={r.code} channel="whatsapp" name={r.phoneName} checked={r.whatsapp} locked={false} size="lg" />
            </span>
          </div>
        ))}
        <div className="text-xs leading-normal text-ink-muted">Cobrança e segurança sempre por e-mail. Nada por WhatsApp entre 22h e 8h.</div>
      </main>

      {/* W08, computer */}
      <main className="mx-auto box-border hidden max-w-[1180px] flex-col gap-5 px-8 py-7 md:flex">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-4xl">Notificações</h1>
            <span className="text-base text-ink-muted">Cada pessoa escolhe o que recebe e por onde. Estas são as suas.</span>
          </div>
          <div className="text-right text-sm leading-[1.6] text-ink-muted">
            {m.email && <div>E-mail: {m.email}</div>}
            {m.whatsappE164 && (
              <div>
                WhatsApp: {maskWhatsapp(m.whatsappE164)} · <Link href="/app/seguranca">trocar</Link>
              </div>
            )}
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[760px] border-collapse text-md">
            <thead>
              <tr className="text-xs tracking-[0.04em] text-ink-muted uppercase">
                <th className="border-b border-border px-3.5 py-3 text-left">Aviso</th>
                <th className="border-b border-border px-3.5 py-3 text-left">Quando</th>
                <th className="border-b border-border px-3.5 py-3">E-mail</th>
                <th className="border-b border-border px-3.5 py-3">WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td className={td}>
                    <b>{r.name}</b>
                    <br />
                    <span className="text-xs text-ink-muted">{r.who}</span>
                  </td>
                  <td className={`${td} text-sm text-ink-2`}>{r.when}</td>
                  <td className={`${td} text-center`}>
                    <PrefToggle code={r.code} channel="email" name={r.name} checked={r.email} locked={r.locked} size="sm" />
                  </td>
                  <td className={`${td} text-center`}>
                    <PrefToggle code={r.code} channel="whatsapp" name={r.name} checked={r.whatsapp} locked={false} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-3 text-sm leading-normal text-ink-muted">
          <span>Avisos de cobrança e de segurança sempre vão por e-mail, por exigência de registro.</span>
          <span>Horário de silêncio: nada por WhatsApp entre 22h e 8h.</span>
          <Link href="/app/notificacoes/exemplo">Ver exemplo de e-mail</Link>
        </div>
      </main>
    </>
  );
}
