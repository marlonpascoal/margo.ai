// The collected menu of a store, as of its latest capture (console). Reads only what the extractor sent
// (docs/extract-api.md): nothing here is calculated from other stores.
import { money } from "./format";

export interface MenuRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_cents: number;
  original_price_cents: number | null;
  minimum_price_cents: number | null;
  unit: string;
  unit_qty: number | null;
  unit_from_name: boolean;
  item_type: string | null;
  choices: unknown;
  collected_at: string;
}

export interface MenuChoice {
  name: string;
  min: number;
  max: number;
  options: { name: string; price_cents: number }[];
}

export type MenuItem = MenuRow & { groups: MenuChoice[] };

export interface MenuView {
  total: number;
  withChoices: number;
  lastCollectedAt: string | null;
  sections: { name: string; items: MenuItem[] }[];
}

const NO_SECTION = "Sem seção";
const byName = (a: string, b: string) => a.localeCompare(b, "pt-BR");

export function menuView(rows: MenuRow[]): MenuView {
  const sections = new Map<string, MenuItem[]>();
  for (const r of rows) {
    const name = r.category ?? NO_SECTION;
    sections.set(name, [...(sections.get(name) ?? []), { ...r, groups: Array.isArray(r.choices) ? (r.choices as MenuChoice[]) : [] }]);
  }
  return {
    total: rows.length,
    withChoices: rows.filter((r) => Array.isArray(r.choices) && r.choices.length > 0).length,
    lastCollectedAt: rows.map((r) => r.collected_at).sort().at(-1) ?? null,
    sections: [...sections.entries()]
      .sort(([a], [b]) => (a === NO_SECTION ? 1 : b === NO_SECTION ? -1 : byName(a, b)))
      .map(([name, items]) => ({ name, items: items.sort((a, b) => byName(a.name, b.name)) })),
  };
}

/** The price as the channel shows it: a variable price reads from its minimum. */
export function priceLabel(r: Pick<MenuRow, "price_cents" | "minimum_price_cents">): string {
  if (r.price_cents > 0) return money(r.price_cents);
  return r.minimum_price_cents ? `a partir de ${money(r.minimum_price_cents)}` : "sem preço";
}

export function originalPriceLabel(r: Pick<MenuRow, "price_cents" | "original_price_cents">): string | null {
  return r.original_price_cents && r.original_price_cents > r.price_cents ? `de ${money(r.original_price_cents)}` : null;
}

/** The size when the channel gave it. One read from the item's name is already on screen, in the name. */
export function sizeLabel(r: Pick<MenuRow, "unit" | "unit_qty" | "unit_from_name">): string | null {
  if (r.unit_qty === null || r.unit_from_name) return null;
  return r.unit === "pack" ? `pack de ${r.unit_qty}` : `${r.unit_qty} ${r.unit}`;
}

export function choiceRuleLabel(min: number, max: number): string {
  if (min === 0) return `opcional, até ${max}`;
  return min === max ? `obrigatório, escolha ${min}` : `obrigatório, de ${min} a ${max}`;
}

export const optionPriceLabel = (cents: number) => (cents === 0 ? "incluso" : `+ ${money(cents)}`);

const DATE = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "08/11/2026 às 23:13", in America/Sao_Paulo. */
export const capturedAtLabel = (iso: string) => `${DATE.format(new Date(iso))} às ${TIME.format(new Date(iso))}`;
