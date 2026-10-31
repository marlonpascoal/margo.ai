// CNPJ check digits (P07: "CNPJ is validated (check digits)"). Digits only are stored (03 company.cnpj).

export const cnpjDigits = (value: string) => value.replace(/\D/g, "");

function digit(body: string): number {
  const weights = body.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** The two check digits for the first 12 digits. */
export function cnpjCheckDigits(first12: string): string {
  const d1 = digit(first12);
  return `${d1}${digit(first12 + d1)}`;
}

export function validCnpj(value: string): boolean {
  const n = cnpjDigits(value);
  if (!/^\d{14}$/.test(n) || /^(\d)\1{13}$/.test(n)) return false;
  return cnpjCheckDigits(n.slice(0, 12)) === n.slice(12);
}

/** "00.000.000/0000-00" */
export function formatCnpj(value: string): string {
  const n = cnpjDigits(value);
  return n.length === 14 ? `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}` : value;
}
