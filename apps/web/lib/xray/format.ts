// Number formats of the M1 screens (C03 to C06), as drawn. Money in centavos (CLAUDE.md).

/** Half away from zero, like the worker (margo_collector.rules.round_half_away). */
const roundAway = (x: number) => Math.sign(x) * Math.floor(Math.abs(x) + 0.5 + 1e-9);

/** "R$ 5,00", "R$ 1.490,00". */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${whole},${String(abs % 100).padStart(2, "0")}`;
}

/** M1-06 gap as drawn: "−23%" (U+2212), "+17%", "0%". */
export function gapLabel(gap: number | string | null): string {
  if (gap === null) return "";
  const n = roundAway(Number(gap) * 100);
  return n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : "0%";
}

/** "31%". */
export const shareLabel = (share: number | string) => `${roundAway(Number(share) * 100)}%`;

/** C03: "0,4 km". */
export const kmLabel = (meters: number) => `${(Math.round(meters / 100) / 10).toFixed(1).replace(".", ",")} km`;

/** C06 hours: 30 minutes is "0,5". */
export const hoursLabel = (minutes: number) => (Math.round(minutes / 6) / 10).toFixed(1).replace(".", ",");

/** "0,5", "1", "1.25" to whole minutes; null when not a number of hours from 0 to 24. */
export function parseHours(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const h = Number(t);
  return h > 24 ? null : Math.round(h * 60);
}
