// Building blocks of the M1 console screens (design/C02 to C06): the step title, buttons, chips, notices.
import Link from "next/link";
import type { ReactNode } from "react";

/** "C03 · Módulo 1 · passo 2 de 4 · Pantanos Burguer", the title and the drawn sentence under it. */
export function XrayTitle({ code, step, store, title, lead }: { code: string; step?: number; store?: string | null; title: string; lead?: string }) {
  const eyebrow = [code, "Módulo 1", step ? `passo ${step} de 4` : null, store].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-xs tracking-[0.06em] text-ink-muted uppercase">{eyebrow}</div>
      <h1 className="m-0 text-4xl font-bold">{title}</h1>
      {lead && <p className="m-0 max-w-[640px] text-base leading-normal text-ink-muted">{lead}</p>}
    </div>
  );
}

export const primaryButton =
  "inline-flex min-h-11 cursor-pointer items-center rounded-md border-0 bg-ink px-4.5 text-base font-semibold text-ink-inverse no-underline hover:text-ink-inverse disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButton =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-border-strong bg-surface px-4.5 text-base text-ink no-underline";

export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={secondaryButton}>
      {children}
    </Link>
  );
}

/** A status line under the title (not drawn: collection, pairing, calculation in progress). */
export function Notice({ tone = "muted", children }: { tone?: "muted" | "warn" | "danger"; children: ReactNode }) {
  const cls = { muted: "border-border bg-surface text-ink-muted", warn: "border-warn-border bg-warn-bg text-ink", danger: "border-danger-border bg-danger-bg text-ink" }[tone];
  return (
    <div role="status" className={`rounded-xl border px-4 py-3 text-md ${cls}`}>
      {children}
    </div>
  );
}

export const card = "min-w-0 rounded-xl border border-border bg-surface";
