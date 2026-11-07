// Words on the M1 screens. Drawn copy is verbatim; entries marked "not drawn" follow the console style
// and are listed in the wave report for Marlon.
import type { Database } from "@margoai/contracts";
import { gapLabel, money } from "./format";

export type Reading = Database["public"]["Enums"]["xray_reading"];
export type PairStatus = Database["public"]["Enums"]["pair_status"];

/** C05 "Leitura" (M1-07), as drawn. */
export const READING_LABEL: Record<Reading, string> = {
  pode_subir: "pode subir hoje",
  na_media: "na faixa",
  nao_mexer: "precisa do custo",
};

/** C04 "Unidade", as drawn ("unidade", "por 100 g", "por 100 ml", "combo"). */
export const UNIT_LABEL: Record<string, string> = { un: "unidade", "100g": "por 100 g", "100ml": "por 100 ml", combo: "combo" };

/** C04 "Situação" (M1-04), as drawn: "pareado", "normalizado", "revisar: poucos pares". */
export function pairStatusLabel(status: PairStatus, note: string | null): string {
  if (status === "revisar") return note ? `revisar: ${note}` : "revisar";
  return { auto: "pareado", normalizado: "normalizado", manual: "manual" }[status];
}

/** C02 category choices, as drawn, and the iFood categories each one searches (M1-02). */
export const CATEGORY_OPTIONS = [
  { value: "lanches", label: "Lanches, hambúrguer, porções", categories: ["Lanches", "Hambúrguer", "Porções"] },
  { value: "hamburguer", label: "Só hambúrguer", categories: ["Hambúrguer"] },
] as const;

/** C02 radius choices (M1-01), as drawn. */
export const RADIUS_OPTIONS = [
  { value: 3, label: "3 km (padrão)" },
  { value: 2, label: "2 km" },
  { value: 5, label: "5 km" },
] as const;

// Not drawn ---------------------------------------------------------------------------------------

export const XRAY_MESSAGES = {
  invalidUrl: "Cole o link de uma loja do iFood: ele termina com o código da loja.",
  invalidForm: "Escolha o raio e as categorias.",
  unknownStore: "Loja ainda não coletada: nome, bairro e categoria aparecem depois da busca.",
  collectQueued: "Na fila: a busca começa quando o coletor estiver livre.",
  collectRunning: "Buscando as lojas da vizinhança.",
  pairingPending: "Pareando os itens. Atualize a página em instantes.",
  calcPending: "Calculando o raio-X. Atualize a página em instantes.",
  pdfPending: "PDF em preparação. Atualize a página em instantes.",
  pdfMissing: "Prepare a entrega no passo 4 para gerar o PDF.",
  notCalculated: "Calcule o raio-X no passo 3.",
  reviewed: "revisado",
  skipped: "fora da conta",
  savePairs: "Salvar pares",
  skip: "Deixar fora da conta",
  unskip: "Voltar para a conta",
  invalidHours: "Horas: use números como 0,5.",
  jobFailed: "A tarefa falhou. Peça para rodar de novo.",
  confirmWaits: "Confirmar libera quando os cardápios terminarem.",
  neighborhoodPending: "Atualizando a vizinhança com os cardápios capturados.",
  pairWaitedForLoad: "O pareamento não rodou: ainda havia cardápios na fila. Confirme o conjunto de novo na vizinhança quando terminarem.",
  unknownAccount: "Conta não encontrada.",
  fullPriceRoom: "pode subir quando os vizinhos não estão em promoção",
} as const;

/** C05 under "Paridade" (M1-05, M1-06): the parity and gap at full prices. Not drawn. */
export const fullParityLabel = (i: { cents: number; gap: number }) => `sem promoção: ${money(i.cents)}, ${gapLabel(i.gap)}`;

/** C02 refusal of a competitor X-ray (B01 competitor, migration 20261212000001): limit 0 means not in the
 * plan or flag m1.concorrente off. Not drawn. */
export function competitorRefusal(limit: number): string {
  if (limit <= 0) return "Raio-X de concorrente fora do plano desta conta.";
  return `Limite do plano atingido: ${limit} raio-X de concorrente por mês. O próximo fica para o mês que vem.`;
}

/** C03: why the collection stopped, from the failed job's log: the extractor's reason (docs/extract-api.md)
 * or a worker exception name. Not drawn. */
export function collectStopReason(error: string | null | undefined, reason?: string | null): string {
  if (reason === "flag_off") return "Coleta parada: o raio-X está desligado para esta conta.";
  if (error === "ExtractionOff") return "Coleta parada: a extração está desligada para esta conta.";
  switch (reason) {
    case "blocked":
      return "Coleta parada: o canal recusou o acesso.";
    case "not_found":
      return "Coleta parada: a loja não foi encontrada nesse link.";
    case "parse_error":
      return "Coleta parada: a página veio em um formato que não sabemos ler.";
    case "timeout":
      return "Coleta parada: a leitura demorou demais.";
    case "stuck":
      return "Coleta parada: a leitura travou duas vezes.";
    default:
      return "Coleta parada: erro ao ler as páginas públicas.";
  }
}

/** C03: the captures of this X-ray's stores (public.xray_capture_states). Not drawn. */
export function captureProgressLabel(c: { done: number; missing: number; failed: number; beyondCap: number; total?: number }): string {
  const parts = [`${c.done} ${c.done === 1 ? "pronto" : "prontos"}`, `${c.missing} faltando`, `${c.failed} com falha`];
  if (c.beyondCap > 0) parts.push(`${c.beyondCap} sem captura pelo limite`);
  return `Cardápios: ${parts.join(", ")}.${c.missing > 0 ? " Confirme o conjunto quando terminar." : ""}`;
}

/** C03 under the store's name (M1-11), rounded only here. Not drawn. */
export const captureRankLabel = (rank: number | null, score: number | null) => (rank === null || score === null ? null : `prioridade ${rank}, nota ${Math.round(score)}`);

/** C03: the capture of the X-ray's own target failed; it is in no list. Not drawn. */
export const targetCaptureFailed = (name: string | null) => `A captura do cardápio de ${name ?? "loja do raio-X"} falhou.`;

/** C04: why the xray_pair job failed, from its log. Not drawn. */
export const pairFailure = (error: string | null | undefined) => (error === "LoadPending" ? XRAY_MESSAGES.pairWaitedForLoad : XRAY_MESSAGES.jobFailed);

/** xray.target_kind as a small label in C02 and C05. */
export const TARGET_KIND_LABEL = { own: "loja própria", competitor: "concorrente" } as const;
