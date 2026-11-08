// Small parts shared by P19 to P24 (prototype m1-owner-journey.html, pending drawings).
import Link from "next/link";
import type { ReactNode } from "react";
import type { PillKind } from "@/lib/monitor/view";

export function Crumb({ children }: { children?: ReactNode }) {
  return (
    <div className="crumb no-print">
      <Link href="/app/raio-x">Raio-X</Link>
      {children ? <> / {children}</> : null}
    </div>
  );
}

/** "dados fictícios" on synthetic accounts (seeded screens, F02). */
export function Fict({ synthetic }: { synthetic: boolean }) {
  return synthetic ? <span className="fict">dados fictícios</span> : null;
}

const PILL: Record<PillKind, string> = { ok: "p-ok", reading: "p-run", doubts: "p-warn", paused: "p-off", plan: "p-off", off: "p-bad", waiting: "p-run" };

export function Pill({ kind, text, href }: { kind: PillKind; text: string; href?: string | null }) {
  const dot = kind === "ok" || kind === "reading" || kind === "waiting" ? <span className="dot" aria-hidden="true" /> : null;
  return href ? (
    <Link className={`pill ${PILL[kind]}`} href={href}>
      {dot}
      {text}
    </Link>
  ) : (
    <span className={`pill ${PILL[kind]}`}>
      {dot}
      {text}
    </span>
  );
}

export function Head({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="head">
      <div>
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
      </div>
      {children ? <div className="row-flex">{children}</div> : null}
    </div>
  );
}
