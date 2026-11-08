// Owner portal shell (05 §B, D32): MenuDono on top, the page below, same pages on phone and computer.
// No valid portal session (30 days): back to P15. Several groups and none chosen: the chooser.
// Pages re-check their own 04 §5 row (canPortal) and flags themselves; this layout is not their check.
import type { ReactNode } from "react";
import MenuDono from "@/components/MenuDono";
import { isEnabled } from "@/lib/flags";
import type { FlagKey } from "@/lib/flags/keys";
import { canPortal } from "@/lib/permissions";
import { MENU_FLAGS } from "@/lib/portal/menu";
import { requireMember } from "@/lib/portal/session";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const m = await requireMember();
  const { count } = await m.db.from("kitchen").select("id", { count: "exact", head: true }).eq("account_id", m.account.id).eq("in_analysis", true);
  // P19 / W10 menu entry: m1.portal on for the account and see_xray (the pages check both again).
  const raioX = canPortal(m.role, "see_xray") && (await isEnabled("m1.portal", m.account.id));
  // X-ray-only launch: entries whose flag is off for the account are hidden (the pages check the flag again).
  const keys = [...new Set(Object.values(MENU_FLAGS))] as FlagKey[];
  const on = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await isEnabled(k, m.account.id)] as const)));
  return (
    <div className="min-h-screen bg-bg font-sans text-ink">
      <MenuDono accountName={m.account.name} kitchensInAnalysis={count ?? 0} role={m.role} raioX={raioX} on={on} />
      {children}
    </div>
  );
}
