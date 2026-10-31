// Console sidebar entries (design/Menu.dc.html, 05 shared components). Labels verbatim from the drawing.
import { canConsoleScreen, type StaffRole } from "@/lib/permissions";

/** What the current page knows; screens that need an account or an X-ray link only when it is known. */
export interface MenuContext {
  accountCode?: string;
  xrayId?: string;
  importRunId?: string;
  /** yyyy-mm of the close being looked at. */
  month?: string;
}

type Href = (ctx: MenuContext) => string | null;

const fixed = (path: string): Href => () => path;
const account = (suffix: string): Href => (c) => (c.accountCode ? `/console/contas/${c.accountCode}${suffix}` : null);
const accountMonth = (suffix: string, after = ""): Href => (c) =>
  c.accountCode && c.month ? `/console/contas/${c.accountCode}${suffix}/${c.month}${after}` : null;
const xray = (suffix: string): Href => (c) => (c.xrayId ? `/console/raio-x/${c.xrayId}${suffix}` : null);

const GROUPS: { title: string; items: [code: string, label: string, href: Href][] }[] = [
  {
    title: "Clientes e cobrança",
    items: [
      ["C21", "Alertas", fixed("/console/alertas")],
      ["C01", "Clientes", fixed("/console")],
      ["C15", "Assinaturas", fixed("/console/assinaturas")],
      ["C19", "Estrutura do cliente", account("/estrutura")],
      ["C18", "Parceiros BPO", fixed("/console/bpo")],
    ],
  },
  {
    title: "Módulo 1 · raio-X",
    items: [
      ["C02", "Novo raio-X", fixed("/console/raio-x/novo")],
      ["C03", "Vizinhança", xray("/vizinhanca")],
      ["C04", "Pareamento", xray("/pareamento")],
      ["C05", "Raio-X de preço", xray("")],
      ["C06", "Entrega", xray("/entrega")],
    ],
  },
  {
    title: "Módulo 2 · canais",
    items: [
      ["C07", "Conectar e importar", account("/importacoes")],
      ["C17", "Corrigir importação", (c) => (c.importRunId ? `/console/importacoes/${c.importRunId}/corrigir` : null)],
      ["C08", "Fechamento", accountMonth("/fechamento")],
      ["C09", "Diferenças", accountMonth("/fechamento", "/diferencas")],
      ["C16", "Contestação", account("/contestacoes")],
    ],
  },
  {
    title: "Módulo 3 · custo",
    items: [
      ["C10", "Notas de compra", account("/notas")],
      ["C11", "De-para de insumos", account("/de-para")],
      ["C12", "Ficha técnica", account("/fichas")],
      ["C13", "Contribuição", accountMonth("/contribuicao")],
    ],
  },
  {
    title: "",
    items: [
      ["C14", "Configurações", fixed("/console/config")],
      ["C20", "Funcionalidades", fixed("/console/funcionalidades")],
    ],
  },
];

export interface MenuItem {
  code: string;
  label: string;
  /** null when the page needs a context (account, X-ray) the current screen does not have. */
  href: string | null;
}
export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

/** Groups and items in drawing order, without the screens this role cannot use (04 §5). */
export function consoleMenu(role: StaffRole, ctx: MenuContext = {}): MenuGroup[] {
  return GROUPS.map((g) => ({
    title: g.title,
    items: g.items.filter(([code]) => canConsoleScreen(role, code)).map(([code, label, href]) => ({ code, label, href: href(ctx) })),
  })).filter((g) => g.items.length > 0);
}
