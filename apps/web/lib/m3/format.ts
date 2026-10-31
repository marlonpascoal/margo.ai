// Labels and sentences of the M3 screens (C12, C13) and W01, as drawn. Numbers come from worker-cost
// (CST-01 to CST-04, CTB-01, CTB-02, DLV-01); these functions only format them.
// Copy not in a drawing is marked "not drawn" and listed for Marlon in the M3 report.
import type { Database } from "@margoai/contracts";
import { CHANNEL_LABEL, MINUS, type Channel } from "@/lib/m2/format";

export type YieldConfidence = Database["public"]["Enums"]["yield_confidence"];
export type PriceSource = Database["public"]["Enums"]["price_source"];

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const MON = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
const WORDS = [
  "zero",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
];
const thousands = (n: number) =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** "36,90", "−9,41": centavos with two decimals, the drawings' minus sign. */
export function money2(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${cents < 0 && abs > 0 ? MINUS : ""}${thousands(Math.floor(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
}

/** "R$ 12,44" */
export const brl2 = (cents: number) => `R$ ${money2(cents)}`;

/** "41%": a fraction as a whole percent. */
export const pctInt = (frac: number) => `${Math.round(frac * 100)}%`;

/** C12 "No prato": "160 g", "1 un", "12,5 ml". */
export function qtyLabel(qty: number, unit: string): string {
  const n = Number.isInteger(qty)
    ? String(qty)
    : String(Number(qty.toFixed(2))).replace(".", ",");
  return `${n} ${unit}`;
}

/** C12 "Rendimento": "85%". */
export const yieldLabel = (y: number) =>
  `${Number((y * 100).toFixed(1))
    .toString()
    .replace(".", ",")}%`;

/** C12 "Preço de onde": CST-01 "nota de 12/out" (NF-e) or "cupom de 03/out" (NFC-e); CST-02 "estimativa regional". */
export function sourceLabel(
  source: PriceSource | null,
  observedOn: string | null,
  model: number | null,
): string {
  if (source === "regional_prior") return "estimativa regional";
  if (source === "invoice" && observedOn)
    return `${model === 65 ? "cupom" : "nota"} de ${observedOn.slice(8, 10)}/${MON[Number(observedOn.slice(5, 7)) - 1]}`;
  return "sem preço"; // not drawn
}

/**
 * C12 note under the lines (CST-04): where the error bar comes from. Drawn: "A barra de erro vem do rendimento
 * declarado e dos dois preços que ainda são estimativa regional." Other combinations are not drawn.
 */
export function errorExplanation(
  lines: { confidence: YieldConfidence; source: PriceSource | null }[],
): string {
  const order: YieldConfidence[] = ["medido", "declarado", "estimado"];
  const loose = order.filter(
    (c) => c !== "medido" && lines.some((l) => l.confidence === c),
  );
  const kinds = loose.length > 0 ? loose : (["medido"] as YieldConfidence[]);
  const yieldPart =
    kinds.length === 1
      ? `do rendimento ${kinds[0]}`
      : `dos rendimentos ${kinds.join(" e ")}`;
  const priors = lines.filter((l) => l.source === "regional_prior").length;
  if (priors === 0)
    return `A barra de erro vem ${yieldPart}. Todos os preços são de nota.`;
  const pricePart =
    priors === 1
      ? "do preço que ainda é estimativa regional"
      : `dos ${WORDS[priors] ?? priors} preços que ainda são estimativa regional`;
  return `A barra de erro vem ${yieldPart} e ${pricePart}.`;
}

export interface ContributionRecord {
  menuItemId: string;
  name: string;
  channel: Channel;
  campaignName: string | null;
  campaignDiscountPct: number | null;
  units: number;
  priceCents: number;
  takeCents: number;
  ingredientCents: number;
  packagingCents: number;
  errorPct: number;
  leftCents: number;
  leftPct: number | null;
  canInvert: boolean;
}

/** C13 "Combo casal, cupom 20%". */
export const rowLabel = (
  r: Pick<ContributionRecord, "name" | "campaignDiscountPct">,
) =>
  r.campaignDiscountPct === null
    ? r.name
    : `${r.name}, cupom ${pctInt(r.campaignDiscountPct)}`;

/** C13 row: item, canal, preço, canal leva, insumos (ingredients plus packaging), sobra, % do preço (CTB-01). */
export function c13Cells(r: ContributionRecord): string[] {
  return [
    rowLabel(r),
    CHANNEL_LABEL[r.channel],
    money2(r.priceCents),
    money2(-r.takeCents),
    money2(-(r.ingredientCents + r.packagingCents)),
    money2(r.leftCents),
    r.leftPct === null ? "" : pctInt(r.leftPct),
  ];
}

/** C13 note (CST-04, CTB-02): the widest error bar of the rows and whether any row can invert. */
export function errorNote(
  rows: Pick<ContributionRecord, "errorPct" | "canInvert">[],
): string {
  const widest = rows.reduce((a, r) => Math.max(a, r.errorPct), 0);
  const head = `Custo com barra de erro de ± ${pctInt(widest)} (ver ficha técnica).`;
  const n = rows.filter((r) => r.canInvert).length;
  if (n === 0)
    return `${head} Um erro desse tamanho não inverte nenhuma linha.`;
  if (n === 1)
    return `${head} Uma linha pode inverter com um erro desse tamanho: está marcada.`; // not drawn
  return `${head} ${n} linhas podem inverter com um erro desse tamanho: estão marcadas.`; // not drawn
}

export interface DecisionRecord {
  kind: "campaign" | "lowest";
  name: string;
  channel: Channel;
  discountPct: number | null;
  leftCents: number;
  baseLeftCents: number | null;
  /** First day of the close month; the decision is for the next month. */
  month: string;
}

const nextMonthName = (month: string) => MONTHS[Number(month.slice(5, 7)) % 12];

function lowestSentence(d: DecisionRecord): string {
  // not drawn: DLV-01 second branch
  return `${d.name} deixa só ${brl2(d.leftCents)} por pedido no ${CHANNEL_LABEL[d.channel]}, a menor sobra entre os itens que mais vendem.`;
}

/** C13 highlighted sentence (DLV-01). Odd indexes are bold, as drawn. */
export function decisionC13(d: DecisionRecord): string[] {
  if (
    d.kind === "campaign" &&
    d.discountPct !== null &&
    d.baseLeftCents !== null
  ) {
    return [
      `O cupom de ${pctInt(d.discountPct)} no `,
      d.name,
      " derruba a contribuição de ",
      brl2(d.baseLeftCents),
      " para ",
      brl2(d.leftCents),
      ` por pedido no ${CHANNEL_LABEL[d.channel]}.`,
    ];
  }
  return [lowestSentence(d)];
}

/** W01 "Uma decisão para outubro." and the sentence (DLV-01). */
export function decisionW01(d: DecisionRecord): [string, string] {
  const title = `Uma decisão para ${nextMonthName(d.month)}.`;
  if (
    d.kind === "campaign" &&
    d.discountPct !== null &&
    d.baseLeftCents !== null
  ) {
    return [
      title,
      `O cupom de ${pctInt(d.discountPct)} no ${d.name} deixa ${brl2(d.leftCents)} por pedido, contra ${brl2(d.baseLeftCents)} sem cupom.`,
    ];
  }
  return [title, lowestSentence(d)];
}
