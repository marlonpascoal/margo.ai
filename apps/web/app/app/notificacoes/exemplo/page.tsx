// W08 "Ver exemplo de e-mail": the close_ready e-mail (E01) as the notifier builds it today, with this
// person's own numbers and scope (A03) and the footer saying why it arrives. When the E01 template lands
// in lib/notify/templates.ts this page should render that template instead.
import Link from "next/link";
import { brl, monthShort } from "@/lib/m2/format";
import { messageFor } from "@/lib/notify/templates";
import { homeNumbers, homePeriods, loadHomeLines } from "@/lib/portal/home";
import { requireMember } from "@/lib/portal/session";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exemplo de e-mail · MargoAI" };

export default async function ExemploEmailPage() {
  const m = await requireMember();
  const db = adminClient();
  const [period] = await homePeriods(db, m.account.id);
  const n = period ? homeNumbers(await loadHomeLines(db, period.id, m), [], null) : null;
  const msg =
    period && n
      ? messageFor(
          { subject: `Fechamento de ${monthShort(period.month)} pronto`, body: `Você vendeu ${brl(n.soldCents)} no delivery e recebeu ${brl(n.receivedCents)}.` },
          { personId: m.personId, accountId: m.account.id, accountName: m.account.name, role: m.role, email: m.email, whatsappE164: m.whatsappE164 },
        )
      : null;
  return (
    <main className="mx-auto box-border flex max-w-[720px] flex-col gap-4 px-4 py-5 md:px-8 md:py-7">
      <Link href="/app/notificacoes" className="text-md">
        Notificações
      </Link>
      <h1 className="m-0 text-2xl md:text-4xl">Exemplo de e-mail</h1>
      {msg ? (
        <article className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <b>{msg.subject}</b>
          <p className="m-0 text-md leading-normal whitespace-pre-line">{msg.body}</p>
        </article>
      ) : (
        <p className="m-0 text-base text-ink-muted">O exemplo aparece quando houver o primeiro fechamento.</p>
      )}
    </main>
  );
}
