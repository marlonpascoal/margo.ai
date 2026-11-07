"use client";
// Console sidebar (design/Menu.dc.html). The server passes only the items the role may use (lib/console/menu.ts).
import Link from "next/link";
import { usePathname } from "next/navigation";
import SignOut from "@/components/SignOut";
import type { MenuGroup } from "@/lib/console/menu";

export interface MenuClient {
  name: string;
  place: string;
}

const itemClass = "flex min-h-[30px] items-center gap-2 rounded-sm px-2 text-md no-underline";

export default function Menu({ groups, client }: { groups: MenuGroup[]; client?: MenuClient }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Console"
      className="box-border flex w-full flex-col gap-4 border-b border-border bg-sunken px-4 py-6 text-ink md:min-h-screen md:w-sidebar md:border-r md:border-b-0"
    >
      <div className="flex flex-col gap-1 px-2">
        <div className="text-lg font-extrabold">MargoAI</div>
        <div className="font-mono text-xs text-ink-muted">console dos fundadores</div>
      </div>
      {client && (
        <div className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm leading-[18px]">
          <b>{client.name}</b>
          <br />
          <span className="text-ink-muted">{client.place}</span>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.title || "settings"} className="flex flex-col gap-0.5">
          {g.title && <div className="px-2 pb-1 font-mono text-2xs tracking-[0.06em] text-ink-muted uppercase">{g.title}</div>}
          {g.items.map((it) => {
            const code = (active: boolean) => (
              <span className={`font-mono text-2xs ${active ? "text-border" : "text-ink-muted"}`}>{it.code}</span>
            );
            if (!it.href) {
              // Needs an account or X-ray in context; reached from C01 rows.
              return (
                <span key={it.code} aria-disabled="true" className={`${itemClass} text-ink-faint`}>
                  {code(false)}
                  {it.label}
                </span>
              );
            }
            const active = it.href === pathname;
            return active ? (
              <Link key={it.code} href={it.href} aria-current="page" className={`${itemClass} bg-ink text-ink-inverse hover:text-ink-inverse`}>
                {code(true)}
                {it.label}
              </Link>
            ) : (
              <Link key={it.code} href={it.href} className={`${itemClass} text-ink`}>
                {code(false)}
                {it.label}
              </Link>
            );
          })}
        </div>
      ))}
      <SignOut surface="console" className={`${itemClass} cursor-pointer border-0 bg-transparent text-left text-ink-muted hover:text-ink disabled:opacity-70 md:mt-auto`} />
    </nav>
  );
}
