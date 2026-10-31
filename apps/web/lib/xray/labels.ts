// Words on the M1 screens. Drawn copy is verbatim; entries marked "not drawn" follow the console style
// and are listed in the wave report for Marlon.
import type { Database } from "@margoai/contracts";

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
  collectRunning: "Buscando as lojas da vizinhança, uma página a cada 3 segundos.",
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
} as const;

/** C03: why the collection stopped, from the failed job's log (worker exception names, D47). */
export function collectStopReason(error: string | null | undefined, reason?: string | null): string {
  if (reason === "flag_off") return "Coleta parada: o raio-X está desligado para esta conta.";
  switch (error) {
    case "AwaitingRecordings":
      return "Coleta parada antes de começar: ainda não há páginas públicas do iFood gravadas para o leitor (fixtures/m1).";
    case "CaptchaBlock":
      return "Coleta parada: o iFood pediu captcha. Nada foi contornado.";
    case "ForbiddenBlock":
      return "Coleta parada: o iFood recusou o acesso. Nada foi contornado.";
    case "RateLimitBlock":
      return "Coleta parada: o iFood pediu para ir mais devagar. Nada foi contornado.";
    case "LoginWall":
      return "Coleta parada: a página pediu login. Só lemos páginas públicas.";
    case "CollectorBusy":
      return "Coleta parada: outro raio-X estava coletando. Um coletor por vez.";
    default:
      return "Coleta parada: erro ao ler as páginas públicas.";
  }
}

/** xray.target_kind as a small label in C02 and C05. */
export const TARGET_KIND_LABEL = { own: "loja própria", competitor: "concorrente" } as const;
