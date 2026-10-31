// Building blocks of the owner account pages, as drawn in design/P*.dc.html (phone) and W*.dc.html
// (computer). One responsive page per pair (D32): phone-only parts use `md:hidden`, computer-only parts
// `hidden md:...`. The top menu (MenuDono) comes from the portal layout, not from these pages.
import Link from "next/link";
import type { ReactNode } from "react";
import { FictitiousLabel } from "@/components/console";

export function PortalMain({ children }: { children: ReactNode }) {
  return <main className="mx-auto box-border flex w-full max-w-[1180px] flex-col gap-3 px-3.5 py-4.5 md:gap-5 md:px-8 md:py-7">{children}</main>;
}

/** Phone: "Minha conta" back to P08 and the "dados fictícios" label of seeded screens. */
export function PhoneTop({ synthetic }: { synthetic: boolean }) {
  return (
    <div className="flex items-center justify-between md:hidden">
      <Link href="/app" className="text-md">
        Minha conta
      </Link>
      {synthetic && <span className="font-mono text-2xs text-ink-muted">dados fictícios</span>}
    </div>
  );
}

/** Computer title block: h1 30px with the drawn lead under it. */
export function DeskTitle({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <div className="hidden flex-wrap items-end justify-between gap-3 md:flex">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-4xl">{title}</h1>
        {lead && <span className="text-base text-ink-muted">{lead}</span>}
      </div>
      {children}
    </div>
  );
}

/** Notice after an action (`?aviso=`), as the console does. */
export function Notice({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p role="status" className="m-0 rounded-md border border-warn-border bg-warn-bg px-4 py-3 text-md">
      {text}
    </p>
  );
}

export function DeskFictitious({ synthetic, extra }: { synthetic: boolean; extra?: string }) {
  if (!synthetic) return null;
  return extra ? <span className="hidden font-mono text-xs text-ink-muted md:inline">{`dados fictícios${extra}`}</span> : <span className="hidden md:inline"><FictitiousLabel /></span>;
}

export const CARD = "rounded-xl border border-border bg-surface";
export const TH = "border-b border-border px-3.5 py-3 font-normal";
export const TD = "border-b border-border-subtle px-3.5 py-3";
export const SMALL_BUTTON = "inline-flex min-h-8.5 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-surface px-2.5 text-sm text-ink";
export const SMALL_BUTTON_DARK = "inline-flex min-h-8.5 cursor-pointer items-center justify-center rounded-sm border-0 bg-ink px-2.5 text-sm text-ink-inverse";
export const PHONE_PRIMARY = "flex min-h-12 items-center justify-center rounded-lg bg-ink font-bold text-ink-inverse no-underline hover:text-ink-inverse";
