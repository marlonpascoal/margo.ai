// P04 Chrome extension, server side (06 §9, D01a, D32): pairing codes, tokens, the reports MargoAI asks for
// and upload checks. Pure functions; database work is in ./server.ts.
import { createHash, randomBytes, randomInt } from "node:crypto";

/** A pairing code is valid for 10 minutes and once. */
export const PAIRING_MINUTES = 10;
/** Upload size limit: an iFood export of a month is well under 5 MB. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const UPLOAD_TYPES: Record<string, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** No 0/O, 1/I/L: the owner types the code into the extension. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "K7M4-Q9TX". */
export function generatePairingCode(rand: (max: number) => number = randomInt): string {
  const c = Array.from({ length: 8 }, () => ALPHABET[rand(ALPHABET.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** What the owner typed, in the canonical form: upper case, 4-4 with a hyphen. Null when it cannot be a code. */
export function normalizePairingCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : null;
}

/** The long token the extension keeps. Shown once, to the extension only. */
export function generateToken(): string {
  return `mgx_${randomBytes(32).toString("base64url")}`;
}

/** Codes and tokens are stored as sha256 hex only (like invites, 03 §1). */
export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** "Authorization: Bearer <token>". */
export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}

export interface RequestedReport {
  key: string;
  name: string;
  period: string;
  requested: boolean;
}

const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "set/2026": the month before `now` in São Paulo, the month the close needs. */
export function previousMonthLabel(now: Date): string {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "numeric" })
    .format(now)
    .split("-")
    .map(Number);
  const pm = m === 1 ? 12 : m - 1;
  return `${MON[pm - 1]}/${m === 1 ? y - 1 : y}`;
}

/**
 * P04 "Relatórios que a MargoAI pediu", as drawn: item sales (the API does not bring them, D07) and the
 * promotions statement for last month; store reviews not needed now.
 */
export function requestedReports(now: Date, hasApi: boolean): RequestedReport[] {
  const month = previousMonthLabel(now);
  return [
    { key: "vendas_por_item", name: "Vendas por item", period: hasApi ? `${month} · a API não traz este` : month, requested: true },
    { key: "promocoes", name: "Extrato de promoções e campanhas", period: month, requested: true },
    { key: "avaliacoes", name: "Avaliações da loja", period: "não precisamos agora", requested: false },
  ];
}

export type UploadCheck = { ok: true; ext: string } | { ok: false; status: 413 | 415; message: string };

export const UPLOAD_MESSAGES = {
  tooLarge: "Arquivo grande demais (até 20 MB).",
  type: "O arquivo precisa ser .csv ou .xlsx, como o Portal do Parceiro exporta.",
  noFile: "Escolha o arquivo que você baixou do Portal do Parceiro.",
  noAuthorization: "Sem autorização do dono para este CNPJ. A importação espera a autorização assinada.",
  flagOff: "Extensão desligada para esta conta.",
  badToken: "Extensão não conectada. Gere um código novo no portal.",
  badCode: "Código inválido ou vencido. Gere um código novo no portal.",
  store: "Loja não encontrada nesta conta.",
} as const;

/** Size limit and file type of an extension upload. */
export function checkUpload(name: string, size: number): UploadCheck {
  if (size > MAX_UPLOAD_BYTES) return { ok: false, status: 413, message: UPLOAD_MESSAGES.tooLarge };
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (!UPLOAD_TYPES[ext] || !name.includes(".")) return { ok: false, status: 415, message: UPLOAD_MESSAGES.type };
  return { ok: true, ext };
}
