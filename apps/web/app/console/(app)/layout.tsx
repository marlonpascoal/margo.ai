// Console shell: sidebar plus page. No valid console session (12 hours, staff only): back to C00.
// Pages re-check their own area with requireConsole(); this layout is not their permission check.
import type { ReactNode } from "react";
import Menu from "@/components/Menu";
import { consoleMenu } from "@/lib/console/menu";
import { requireConsole } from "@/lib/console/staff";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const staff = await requireConsole("clients");
  return (
    <div className="flex min-h-screen flex-wrap bg-bg font-sans text-ink">
      <Menu groups={consoleMenu(staff.role)} />
      {children}
    </div>
  );
}
