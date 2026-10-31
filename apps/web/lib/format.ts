// Display formats shared by screens. Dates in America/Sao_Paulo (CLAUDE.md).
export const TIME_ZONE = "America/Sao_Paulo";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function partsInSaoPaulo(d: Date): { day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { day: get("day"), month: get("month"), year: get("year") };
}

/** "29/out", as drawn. */
export function dayMonth(d: Date): string {
  const { day, month } = partsInSaoPaulo(d);
  return `${day}/${MONTHS[month - 1]}`;
}

/** First instant of the current month in São Paulo, as an ISO string. */
export function monthStartSaoPaulo(now: Date): string {
  const { month, year } = partsInSaoPaulo(now);
  // São Paulo has no daylight saving time since 2019: UTC-3 all year.
  return new Date(Date.UTC(year, month - 1, 1, 3)).toISOString();
}

/** "iFood e 99Food", "a, b e c". */
export function joinPt(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
