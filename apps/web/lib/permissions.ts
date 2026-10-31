// Permission matrix of 04-rules §5 (D33), the only place the app decides who may do what (02 §5).
// UI hiding uses these too, but it is not security: every page and server action re-checks.
import type { Database } from "@margoai/contracts";

export type StaffRole = Database["public"]["Enums"]["staff_role"];
export type MemberRole = Database["public"]["Enums"]["member_role"];

// Console ------------------------------------------------------------------------------------------

/** Rows of the console table in 04 §5. */
export type ConsoleArea = "clients" | "billing" | "settings" | "flags";

const CONSOLE: Record<ConsoleArea, readonly StaffRole[]> = {
  // Clients, X-rays, imports, de-para, recipes, deliveries, contestations, alerts.
  clients: ["fundador", "operacao"],
  // Subscriptions, pilots, BPO prices (C15, C18 prices).
  billing: ["fundador"],
  // Settings: secrets status, staff invites (C14).
  settings: ["fundador"],
  // Feature toggles (C20).
  flags: ["fundador"],
};

const SCREEN_AREA: Record<string, ConsoleArea> = {
  C14: "settings",
  C15: "billing",
  C20: "flags",
};

export function canConsole(role: StaffRole | null | undefined, area: ConsoleArea): boolean {
  return !!role && CONSOLE[area].includes(role);
}

/** Area a console screen belongs to; C18 is visible to both, only its prices are `billing`. */
export function consoleScreenArea(code: string): ConsoleArea | undefined {
  if (!/^C\d{2}$/.test(code)) return undefined;
  return SCREEN_AREA[code] ?? "clients";
}

export function canConsoleScreen(role: StaffRole | null | undefined, code: string): boolean {
  const area = consoleScreenArea(code);
  return !!area && canConsole(role, area);
}

// Owner portal -------------------------------------------------------------------------------------

/** Rows of the owner portal table in 04 §5. */
export type PortalAction =
  | "see_close"
  | "contestations"
  | "send_invoices"
  | "see_xray"
  | "choose_kitchens"
  | "billing"
  | "people"
  | "delete_account";

const PORTAL: Record<PortalAction, readonly MemberRole[]> = {
  // Gerente de cozinha: own kitchens only (scope is applied to the data, not here).
  see_close: ["dono", "financeiro", "gerente"],
  contestations: ["dono", "financeiro", "gerente"],
  send_invoices: ["dono", "financeiro", "gerente"],
  see_xray: ["dono", "financeiro", "gerente"],
  choose_kitchens: ["dono"],
  billing: ["dono"],
  people: ["dono"],
  // Dono with code confirmation.
  delete_account: ["dono"],
};

export function canPortal(role: MemberRole | null | undefined, action: PortalAction): boolean {
  return !!role && PORTAL[action].includes(role);
}

/** Owner menu entries (MenuDono). Pessoas stays for everyone: others see only themselves (05 P14/W04). */
export function portalScreenAllowed(role: MemberRole | null | undefined, code: string): boolean {
  if (!role) return false;
  if (code === "W05") return canPortal(role, "billing");
  return true;
}
