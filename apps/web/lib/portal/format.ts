// Formats of the owner portal, as drawn (P07, P08, W01, W08, W09). Dates in America/Sao_Paulo.

const TZ = "America/Sao_Paulo";
const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DAY_MS = 24 * 60 * 60_000;

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "2026-10-30": the São Paulo calendar day of an instant. */
export const spDay = (d: Date) => ymd.format(d);
const dayNumber = (d: Date) => Date.parse(`${spDay(d)}T00:00:00Z`) / DAY_MS;
/** "30/out" */
export const dayMon = (d: Date) => {
  const [, m, day] = spDay(d).split("-");
  return `${day}/${MON[Number(m) - 1]}`;
};

/** W08, W09: "(43) 9 ••••-1234". */
export function maskWhatsapp(e164: string | null): string {
  if (!e164) return "";
  const n = e164.replace(/\D/g, "").replace(/^55/, "");
  return `(${n.slice(0, 2)}) ${n.slice(2, 3)} ••••-${n.slice(-4)}`;
}

/** P07: a Brazilian mobile typed any way ("(43) 9 1234-5678") to E.164, or null. */
export function parseWhatsapp(input: string): string | null {
  let n = input.replace(/\D/g, "");
  if (n.length === 13 && n.startsWith("55")) n = n.slice(2);
  if (!/^\d{2}9\d{8}$/.test(n)) return null;
  return `+55${n}`;
}

/** P08, W01 trial banner: São Paulo calendar days from today to the trial's last day (04 §7). */
export function trialDaysLeft(endsAt: Date, now: Date): number {
  return Math.max(0, dayNumber(endsAt) - dayNumber(now));
}

/** P08 progress bar: share of the trial already used, in whole percent. */
export function trialUsedPct(daysLeft: number, trialDays: number): number {
  if (trialDays <= 0) return 100;
  return Math.round((Math.max(0, trialDays - daysLeft) * 100) / trialDays);
}

/** W09 device names, as drawn: "Chrome no Mac", "Celular Android", "Chrome no Windows". */
export function deviceName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Celular Android";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  if (browser && os) return `${browser} no ${os}`;
  return browser ?? os ?? "Aparelho";
}

function relativeDay(d: Date, now: Date): "hoje" | "ontem" | null {
  const diff = dayNumber(now) - dayNumber(d);
  return diff === 0 ? "hoje" : diff === 1 ? "ontem" : null;
}

/** W09 access log: "hoje 08:12", "ontem 17:40", "29/out 10:02". */
export function accessWhen(d: Date, now: Date): string {
  return `${relativeDay(d, now) ?? dayMon(d)} ${hm.format(d)}`;
}

/** W09 devices: "ontem 21:10", "27/out". */
export function deviceWhen(d: Date, now: Date): string {
  const rel = relativeDay(d, now);
  return rel ? `${rel} ${hm.format(d)}` : dayMon(d);
}

/** W01 drawn kitchen names drop the word "Cozinha" ("Centro · iFood"). */
export const kitchenShort = (name: string) => name.replace(/^Cozinha\s+/i, "");
