// Owner top menu entries (design/MenuDono.dc.html, 05 shared components). Labels verbatim from the drawing.
import type { FlagKey } from "@/lib/flags/keys";
import { portalScreenAllowed, type MemberRole } from "@/lib/permissions";

const ITEMS: [code: string, label: string, href: string][] = [
  ["W01", "Início", "/app"],
  // M1 owner journey (P19 / W10), behind m1.portal; not drawn yet (prototype m1-owner-journey.html), between Início and Lojas.
  ["W10", "Raio-X", "/app/raio-x"],
  ["W02", "Lojas", "/app/lojas"],
  ["W03", "Contestações", "/app/contestacoes"],
  ["W04", "Pessoas", "/app/pessoas"],
  ["W05", "Plano e cobrança", "/app/plano"],
  ["W08", "Notificações", "/app/notificacoes"],
  ["W09", "Segurança", "/app/seguranca"],
];

export interface OwnerMenuItem {
  code: string;
  label: string;
  href: string;
}

/** The flag each entry needs (X-ray-only launch, 20261231000005; the pages check it again). Others always show. */
export const MENU_FLAGS: Partial<Record<string, FlagKey>> = {
  W01: "portal.inicio",
  W02: "portal.lojas",
  W03: "m2.contestacao",
  W04: "conta.pessoas",
  W05: "conta.plano",
};

/** `flags.on`: the account's flags; without it the flagged entries show (the drawing's menu). */
export function ownerMenu(role: MemberRole, flags: { raioX?: boolean; on?: Partial<Record<FlagKey, boolean>> } = {}): OwnerMenuItem[] {
  const flagOk = (code: string) => {
    const k = MENU_FLAGS[code];
    return !k || !flags.on || !!flags.on[k];
  };
  return ITEMS.filter(([code]) => portalScreenAllowed(role, code) && (code !== "W10" || !!flags.raioX) && flagOk(code)).map(([code, label, href]) => ({ code, label, href }));
}

/** Role line at the right of the menu. "Dono do grupo" is drawn; the others use the 04 §5 profile names. */
export const ROLE_LABEL: Record<MemberRole, string> = {
  dono: "Dono do grupo",
  financeiro: "Financeiro",
  gerente: "Gerente de cozinha",
};

/** "Grupo Exemplo · 2 cozinhas": kitchens in analysis (03 kitchen.in_analysis). */
export function accountChip(accountName: string, kitchensInAnalysis: number): string {
  return `${accountName} · ${kitchensInAnalysis} ${kitchensInAnalysis === 1 ? "cozinha" : "cozinhas"}`;
}
