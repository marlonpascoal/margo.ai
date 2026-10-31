// 06 §5, D13: NF-e and NFC-e access keys, typed (44 digits) or read from the QR link's `p=` parameter.
// Same rule as app.nfe_access_key_valid and workers/import margo_import.invoices.

/** Mod 11 check digit over the first 43 digits, weights 2 to 9 from the right; remainder 0 or 1 gives 0. */
export function keyCheckDigit(first43: string): number {
  let total = 0;
  let weight = 2;
  for (let i = first43.length - 1; i >= 0; i--) {
    total += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const r = total % 11;
  return r < 2 ? 0 : 11 - r;
}

export function keyValid(key: string): boolean {
  return /^\d{44}$/.test(key) && keyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

/** Model 55 (NF-e) or 65 (NFC-e), digits 21 and 22. */
export const keyModel = (key: string) => Number(key.slice(20, 22));
/** Issuer CNPJ, digits 7 to 20. */
export const keyIssuer = (key: string) => key.slice(6, 20);
/** First day of the issue month (AAMM, digits 3 to 6), São Paulo midnight. */
export const keyMonthStart = (key: string) => `20${key.slice(2, 4)}-${key.slice(4, 6)}-01T00:00:00-03:00`;

export type KeySource = "key_typed" | "qr_url";

/** C10 "Cupom avulso": the key and how it came, or null when no valid NF-e or NFC-e key is there. */
export function keyFromInput(text: string): { key: string; source: KeySource } | null {
  const s = text.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    let p: string | null = null;
    try {
      p = new URL(s).searchParams.get("p");
    } catch {
      return null;
    }
    const key = (p ?? "").split("|")[0].trim();
    return keyValid(key) && [55, 65].includes(keyModel(key)) ? { key, source: "qr_url" } : null;
  }
  const key = s.replace(/\s/g, "");
  return keyValid(key) && [55, 65].includes(keyModel(key)) ? { key, source: "key_typed" } : null;
}
