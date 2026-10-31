// Building blocks shared by console pages, as drawn in design/C*.dc.html.
import type { ReactNode } from "react";

export function ConsoleMain({ children }: { children: ReactNode }) {
  return <main className="box-border flex min-w-0 flex-[999_1_560px] flex-col gap-6 px-4 py-6 md:px-10 md:py-8">{children}</main>;
}

/**
 * `who` is the drawn role note after "Console" ("só papel Fundador"); `lead` the drawn sentence under the title.
 * `kicker` replaces the whole line above the title when the drawing has its own ("C07 · Módulo 2 · ...").
 */
export function PageTitle({ code, title, who, lead, kicker }: { code: string; title: string; who?: string; lead?: string; kicker?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-xs tracking-[0.06em] text-ink-muted uppercase">{kicker ?? `${code} · Console${who ? ` · ${who}` : ""}`}</div>
      <h1 className="m-0 text-4xl font-bold">{title}</h1>
      {lead && <p className="m-0 text-base leading-normal text-ink-muted">{lead}</p>}
    </div>
  );
}

/** "dados fictícios": only when the screen renders synthetic accounts (05 intro). */
export function FictitiousLabel() {
  return <span className="rounded-xs border border-dashed border-ink-faint px-2 py-0.5 font-mono text-xs text-ink-muted">dados fictícios</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 ${className}`}>{children}</section>;
}

/** Pill with a status tone, as drawn (ok, warn, danger, neutral). */
export const TONE_BG = { ok: "bg-ok-bg", warn: "bg-warn-bg", danger: "bg-danger-bg", run: "bg-sunken", muted: "bg-muted-bg", surface: "bg-surface" } as const;
export function Pill({ tone, children }: { tone: keyof typeof TONE_BG; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.75 text-xs whitespace-nowrap ${TONE_BG[tone]}`}>{children}</span>;
}

/** Primary (ink) and secondary (outlined) buttons and links, as drawn. */
export const BUTTON_PRIMARY =
  "inline-flex min-h-11 cursor-pointer items-center rounded-md border-0 bg-ink px-4.5 text-base font-semibold text-ink-inverse no-underline hover:text-ink-inverse";
export const BUTTON_SECONDARY =
  "inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-strong bg-surface px-4.5 text-base text-ink no-underline";
