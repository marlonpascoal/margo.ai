// Money, month and label formats of the M2 screens, as drawn (C07, C08, C09, C16, C17).
// Money is integer centavos everywhere (CLAUDE.md); screens round to whole reais only where drawn.
import type { Database } from "@margoai/contracts";

export type Channel = Database["public"]["Enums"]["channel"];

export const CHANNEL_LABEL: Record<Channel, string> = { ifood: "iFood", food99: "99Food", keeta: "Keeta", rappi: "Rappi" };
export const CHANNEL_ORDER: Channel[] = ["ifood", "food99", "keeta", "rappi"];

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** The minus sign of the drawings (U+2212), not a dash. */
export const MINUS = "−";

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Whole reais, half up: 9240000 -> "92.400". */
export function reais(cents: number): string {
  const r = Math.round(Math.abs(cents) / 100);
  return (cents < 0 && r > 0 ? MINUS : "") + thousands(r);
}

/** "R$ 92.400" */
export const brl = (cents: number) => `R$ ${reais(cents)}`;

/** "R$ 14.471,00" */
export function brlCents(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? MINUS : ""}R$ ${thousands(Math.floor(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
}

/** C08 deduction cell: "−11.088", or "0". */
export const deduction = (cents: number) => (Math.round(cents / 100) === 0 ? "0" : reais(cents));

/** "74,5%" */
export function percent(num: number, den: number, digits = 1): string {
  if (den === 0) return "0%";
  return `${((num * 100) / den).toFixed(digits).replace(".", ",")}%`;
}

/** "1.204" */
export const count = (n: number) => thousands(n);

/** "2026-09" <-> first day; "set/2026"; "setembro". */
export function parseMonth(ym: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  return m ? `${m[1]}-${m[2]}-01` : null;
}
export const monthShort = (isoDay: string) => `${MON[Number(isoDay.slice(5, 7)) - 1]}/${isoDay.slice(0, 4)}`;
export const monthLong = (isoDay: string) => MONTHS[Number(isoDay.slice(5, 7)) - 1];
export const yearMonth = (isoDay: string) => isoDay.slice(0, 7);

/** "02/out", "15/nov" from a date column (yyyy-mm-dd), as drawn in C09 and C16. */
export const dayMon = (isoDay: string) => `${isoDay.slice(8, 10)}/${MON[Number(isoDay.slice(5, 7)) - 1]}`;

/** Period of an import (C07): "24 a 30/out", "set/2026", "28/set a 3/out". */
export function periodLabel(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const lastDay = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).getUTCDate();
  if (start.slice(0, 7) === end.slice(0, 7) && start.slice(8) === "01" && Number(end.slice(8)) === lastDay) return monthShort(start);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${start.slice(8)} a ${dayMon(end)}`;
  return `${dayMon(start)} a ${dayMon(end)}`;
}

/** Duration of an import (C07): "40 s", "2 min". */
export function durationLabel(ms: number | null): string {
  if (ms === null) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
