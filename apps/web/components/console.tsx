// Building blocks shared by console pages, as drawn in design/C*.dc.html.
import type { ReactNode } from "react";

export function ConsoleMain({ children }: { children: ReactNode }) {
  return <main className="box-border flex min-w-0 flex-[999_1_560px] flex-col gap-6 px-4 py-6 md:px-10 md:py-8">{children}</main>;
}

export function PageTitle({ code, title }: { code: string; title: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-xs tracking-[0.06em] text-ink-muted uppercase">{code} · Console</div>
      <h1 className="m-0 text-4xl font-bold">{title}</h1>
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
