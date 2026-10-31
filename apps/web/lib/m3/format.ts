// Prices of M3 screens, as drawn: "R$ 38,90/kg", "R$ 8,40/l", "R$ 2,85/un" (C10, C11, P05).
// Ingredient prices are centavos per base unit (g, ml, un), fractional (CST-01); shown per kg, l or un.
import { brlCents } from "@/lib/m2/format";

export type BaseUnit = "g" | "ml" | "un";

const SHOWN: Record<BaseUnit, { per: number; label: string }> = { g: { per: 1000, label: "kg" }, ml: { per: 1000, label: "l" }, un: { per: 1, label: "un" } };

/** CST-01 price per base unit in centavos to the drawn label, half up to the centavo. */
export function unitPriceLabel(centsPerBase: number, base: BaseUnit): string {
  const s = SHOWN[base];
  return `${brlCents(Math.round(centsPerBase * s.per))}/${s.label}`;
}

/** Line price per base unit: total / (qty x base units per invoice unit) (same as confirm_ingredient_match). */
export function linePricePerBase(totalCents: number, qty: number, conversion: number): number {
  return totalCents / (qty * conversion);
}
