// Owner portal shell (05 §B, D32): MenuDono on top, the page below, same pages on phone and computer.
// No valid portal session (30 days): back to P15. Several groups and none chosen: the chooser.
// Pages re-check their own 04 §5 row (canPortal) and flags themselves; this layout is not their check.
import type { ReactNode } from "react";
import MenuDono from "@/components/MenuDono";
import { requireMember } from "@/lib/portal/session";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const m = await requireMember();
  const { count } = await m.db.from("kitchen").select("id", { count: "exact", head: true }).eq("account_id", m.account.id).eq("in_analysis", true);
  return (
    <div className="min-h-screen bg-bg font-sans text-ink">
      <MenuDono accountName={m.account.name} kitchensInAnalysis={count ?? 0} role={m.role} />
      {children}
    </div>
  );
}
