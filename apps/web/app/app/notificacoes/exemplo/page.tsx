// W08 "Ver exemplo de e-mail": the close_ready e-mail as the owner gets it, from the E01 template in
// apps/web/emails (design/E01-EmailFechamento.dc.html), with this person's own numbers and scope (A03) and
// the footer saying why it arrives. Shown in a sandboxed frame, as the mail client renders it.
import Link from "next/link";
import { renderEmail } from "@/emails";
import { homePeriods, loadHomeDiffs, loadHomeLines } from "@/lib/portal/home";
import { closeReadyExample } from "@/lib/portal/notices";
import { requireMember } from "@/lib/portal/session";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exemplo de e-mail · MargoAI" };

export default async function ExemploEmailPage() {
  const m = await requireMember();
  const db = adminClient();
  const [period] = await homePeriods(db, m.account.id);
  const [lines, diffs] = period ? await Promise.all([loadHomeLines(db, period.id, m), loadHomeDiffs(db, period.id, m)]) : [[], []];
  const msg = period
    ? renderEmail(
        closeReadyExample(m.account.name, period.month, lines, diffs),
        { personId: m.personId, accountId: m.account.id, accountName: m.account.name, role: m.role, email: m.email, whatsappE164: m.whatsappE164 },
        { synthetic: m.account.isSynthetic },
      )
    : null;
  return (
    <main className="mx-auto box-border flex max-w-[720px] flex-col gap-4 px-4 py-5 md:px-8 md:py-7">
      <Link href="/app/notificacoes" className="text-md">
        Notificações
      </Link>
      <h1 className="m-0 text-2xl md:text-4xl">Exemplo de e-mail</h1>
      {msg?.html ? (
        <>
          <b data-email-subject>{msg.subject}</b>
          <iframe title="Exemplo de e-mail" sandbox="" srcDoc={msg.html} className="h-[820px] w-full rounded-xl border border-border bg-surface" />
        </>
      ) : (
        <p className="m-0 text-base text-ink-muted">O exemplo aparece quando houver o primeiro fechamento.</p>
      )}
    </main>
  );
}
