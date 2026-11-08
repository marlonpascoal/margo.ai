"use client";
// Owner top menu (design/MenuDono.dc.html). On phone the entries become the P08 list, so only the
// brand, account and role stay in the bar (05 shared components).
import Link from "next/link";
import { usePathname } from "next/navigation";
import SignOut from "@/components/SignOut";
import { accountChip, ownerMenu, ROLE_LABEL } from "@/lib/portal/menu";
import type { MemberRole } from "@/lib/permissions";

const itemClass = "inline-flex min-h-10 items-center rounded-md px-3 text-md no-underline";

export default function MenuDono({ accountName, kitchensInAnalysis, role, raioX = false }: { accountName: string; kitchensInAnalysis: number; role: MemberRole; raioX?: boolean }) {
  const pathname = usePathname();
  return (
    <header className="box-border flex print:hidden min-h-16 w-full flex-wrap items-center gap-x-7 gap-y-3 border-b border-border bg-surface px-4 py-2.5 text-ink md:px-8">
      <b className="text-lg">MargoAI</b>
      <div className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm">{accountChip(accountName, kitchensInAnalysis)}</div>
      <nav aria-label="Portal do dono" className="hidden flex-auto flex-wrap gap-1 md:flex">
        {ownerMenu(role, { raioX }).map((it) => {
          const active = it.href === "/app" ? pathname === "/app" : pathname.startsWith(it.href);
          return active ? (
            <Link key={it.code} href={it.href} aria-current="page" className={`${itemClass} bg-ink text-ink-inverse hover:text-ink-inverse`}>
              {it.label}
            </Link>
          ) : (
            <Link key={it.code} href={it.href} className={`${itemClass} text-ink`}>
              {it.label}
            </Link>
          );
        })}
      </nav>
      <span className="text-sm text-ink-muted">{ROLE_LABEL[role]}</span>
      <SignOut surface="portal" className="min-h-10 cursor-pointer border-0 bg-transparent px-1 text-sm text-ink-muted hover:text-ink disabled:opacity-70" />
    </header>
  );
}
