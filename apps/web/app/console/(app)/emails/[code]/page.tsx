// "Ver e-mail que o dono recebe" (C21, 05 §A): the ten notice e-mails of 04 §9 with G-SYN examples. E01 and E02
// are drawn; the others follow their layout. Not a drawn screen: copy short and listed for Marlon.
import Link from "next/link";
import { notFound } from "next/navigation";
import { BUTTON_SECONDARY, ConsoleMain, FictitiousLabel, PageTitle } from "@/components/console";
import { DRAWN, EXAMPLES } from "@/emails";
import { SENDER } from "@/emails/layout";
import { requireConsole } from "@/lib/console/staff";
import type { NoticeCode } from "@/lib/notify/templates";
import { NOTICE_NAMES } from "@/lib/notify/preview";
import { sendExamplesAction } from "./actions";

export const metadata = { title: "E-mail que o dono recebe · MargoAI" };

export default async function EmailPreviewPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ aviso?: string }> }) {
  await requireConsole("clients");
  const { code } = await params;
  const { aviso } = await searchParams;
  if (!(code in EXAMPLES)) notFound();
  const c = EXAMPLES[code as NoticeCode];
  const local = process.env.MARGO_ENV === "local";
  return (
    <ConsoleMain>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle code="C21" title="E-mail que o dono recebe" kicker={`${DRAWN[code as NoticeCode] ?? "C21"} · Alertas · e-mails dos avisos`} />
        <FictitiousLabel />
      </div>
      {aviso && (
        <p role="status" className="m-0 rounded-md bg-ok-bg px-3 py-2 text-md">
          {aviso}
        </p>
      )}
      <nav aria-label="Avisos" className="flex flex-wrap gap-2">
        {(Object.keys(EXAMPLES) as NoticeCode[]).map((k) => (
          <Link
            key={k}
            href={`/console/emails/${k}`}
            aria-current={k === code ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm no-underline ${k === code ? "border-ink bg-ink text-ink-inverse hover:text-ink-inverse" : "border-border bg-surface"}`}
          >
            {DRAWN[k] ? `${DRAWN[k]} · ` : ""}
            {NOTICE_NAMES[k]}
          </Link>
        ))}
      </nav>
      <div className="flex max-w-[640px] flex-col gap-3 rounded-xl bg-sunken p-6">
        <div className="px-1 text-sm leading-relaxed text-ink-2">
          <b>De:</b> {SENDER.name} &lt;{SENDER.email}&gt;
          <br />
          <b>Assunto:</b> <span data-subject>{c.subject}</span>
        </div>
        <iframe title={`E-mail: ${c.subject}`} src={`/console/emails/${code}/html`} className="h-[720px] w-full rounded-xl border-0 bg-surface" />
      </div>
      {local && (
        <form action={sendExamplesAction} className="flex flex-wrap items-center gap-3">
          <button type="submit" className={BUTTON_SECONDARY}>
            Mandar os 10 exemplos para o inbox local
          </button>
          <span className="text-sm text-ink-muted">Só no ambiente local: vão para o Mailpit, e o WhatsApp para a fila em Alertas.</span>
        </form>
      )}
    </ConsoleMain>
  );
}
