// Owner top menu entries (design/MenuDono.dc.html, 05 shared components). Labels verbatim from the drawing.
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

export function ownerMenu(role: MemberRole, flags: { raioX?: boolean } = {}): OwnerMenuItem[] {
  return ITEMS.filter(([code]) => portalScreenAllowed(role, code) && (code !== "W10" || !!flags.raioX)).map(([code, label, href]) => ({ code, label, href }));
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
