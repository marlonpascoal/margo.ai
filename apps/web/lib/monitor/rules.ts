// M1 owner journey, pure parts (docs/m1-owner-journey-draft.md; migrations 20261230000001 and 20261230000002). No I/O:
// unit-tested in monitor.test.ts. Copy is pt-BR as in the draft; the drawings (P19 to P24) do not exist yet, so every
// string here is provisional until design/ has them.
import type { MemberRole } from "@/lib/permissions";

/** P20 "Frequência": the periods offered; only values at or above the plan minimum are shown (monitor_limits). */
export const PERIOD_OPTIONS = [
  { days: 7, label: "Toda semana (recomendado)" },
  { days: 14, label: "A cada 2 semanas" },
  { days: 28, label: "Todo mês" },
  { days: 90, label: "Uma vez por trimestre" },
] as const;

export function periodOptions(minEveryDays: number) {
  return PERIOD_OPTIONS.filter((p) => p.days >= minEveryDays);
}

/** M1-04 Stage 1 categories plus the two groups of the screens (Marlon, 07/nov: items by category, never one list). */
export const GROUPS = ["bebidas", "lanches", "porcoes", "pratos", "sobremesas", "adicionais", "sem_categoria", "so_seus"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<Group, string> = {
  bebidas: "Bebidas",
  lanches: "Lanches",
  porcoes: "Porções",
  pratos: "Pratos",
  sobremesas: "Sobremesas",
  adicionais: "Adicionais",
  sem_categoria: "Sem categoria",
  so_seus: "Só seus",
};

// Permissions (draft §2.1, PROVISIONAL Q1). The server functions decide; these only mirror them for the UI. -----------

/** Start, pause, resume, remove, change period: Dono only. */
export const canManageMonitors = (role: MemberRole) => role === "dono";

/** Answer doubts: Dono, and a Gerente for monitorings of their kitchens while m1.portal_gerente_answers is 1. */
export function canAnswerDoubts(role: MemberRole, opts: { gerenteAnswers: boolean; monitorKitchenId: string | null; kitchenIds: readonly string[]; allKitchens: boolean }): boolean {
  if (role === "dono") return true;
  if (role !== "gerente" || !opts.gerenteAnswers || !opts.monitorKitchenId) return false;
  return opts.allKitchens || opts.kitchenIds.includes(opts.monitorKitchenId);
}

// Refusals of the SQL functions, as the screens say them ----------------------------------------------------------------

export type Refusal =
  | { code: "not_enabled" }
  | { code: "not_allowed" }
  | { code: "bad_store" }
  | { code: "bad_kitchen" }
  | { code: "exists"; monitorId: string }
  | { code: "min_every_days"; days: number }
  | { code: "competitor_not_in_plan" }
  | { code: "competitor_limit"; limit: number }
  | { code: "competitor_month_limit"; limit: number }
  | { code: "own_limit"; limit: number }
  | { code: "paused_by_plan" }
  | { code: "already_answered" }
  | { code: "not_active" | "not_paused" | "removed" };

/** The refusal a monitor_* function raised, or null for anything else (which is rethrown). */
export function monitorRefusal(message: string): Refusal | null {
  const num = (re: RegExp) => Number(re.exec(message)?.[1]);
  if (message.includes("monitor_not_enabled")) return { code: "not_enabled" };
  if (message.includes("monitor_not_allowed")) return { code: "not_allowed" };
  if (message.includes("monitor_bad_store")) return { code: "bad_store" };
  if (message.includes("monitor_bad_kitchen")) return { code: "bad_kitchen" };
  const ex = /monitor_exists:([0-9a-f-]{36})/.exec(message);
  if (ex) return { code: "exists", monitorId: ex[1] };
  if (message.includes("monitor_min_every_days:")) return { code: "min_every_days", days: num(/monitor_min_every_days:(\d+)/) };
  if (message.includes("competitor_xray_not_in_plan")) return { code: "competitor_not_in_plan" };
  if (message.includes("monitor_competitor_month_limit:")) return { code: "competitor_month_limit", limit: num(/monitor_competitor_month_limit:(\d+)/) };
  if (message.includes("monitor_competitor_limit:")) return { code: "competitor_limit", limit: num(/monitor_competitor_limit:(\d+)/) };
  if (message.includes("monitor_own_limit:")) return { code: "own_limit", limit: num(/monitor_own_limit:(\d+)/) };
  if (message.includes("monitor_paused_by_plan")) return { code: "paused_by_plan" };
  if (message.includes("monitor_already_answered")) return { code: "already_answered" };
  if (message.includes("monitor_not_active")) return { code: "not_active" };
  if (message.includes("monitor_not_paused")) return { code: "not_paused" };
  if (message.includes("monitor_removed")) return { code: "removed" };
  return null;
}

/** Draft §2.4 and §2.6 copy for a refusal (PROVISIONAL until drawn). */
export function refusalText(r: Refusal): string {
  switch (r.code) {
    case "bad_store":
      return "Este link não é de uma loja do iFood.";
    case "exists":
      return "Você já acompanha esta loja.";
    case "competitor_limit":
      return `Seu plano permite ${r.limit} concorrentes ao mesmo tempo. Pause ou remova um, ou veja os planos.`;
    case "competitor_month_limit":
      return `Seu plano permite começar ${r.limit} concorrentes por mês. Volta no mês que vem, ou veja os planos.`;
    case "competitor_not_in_plan":
      return "Concorrentes fazem parte do plano Lucro.";
    case "own_limit":
      return `Seu plano acompanha ${r.limit === 1 ? "uma loja sua" : `${r.limit} lojas suas`}. Pause ou remova uma, ou veja os planos.`;
    case "min_every_days":
      return `No seu plano, o raio-X roda no máximo a cada ${r.days} dias.`;
    case "paused_by_plan":
      return "Pausado pelo plano. Volta quando você assinar o Lucro.";
    case "already_answered":
      return "Outra pessoa já respondeu este item.";
    default:
      return "Não salvou. Tente de novo.";
  }
}

/** P22 "one plain reason" for a doubt, from M1-04's pair_note (owner words, draft §1). */
export function doubtReason(pairNote: string | null, stores: number): string {
  switch (pairNote) {
    case "tamanho ilegível":
      return "Não deu para ler o tamanho no nome";
    case "tipo ilegível":
    case "categoria não identificada":
      return "Não sabemos o tipo deste item";
    case "marca ilegível":
      return "Não deu para ler a marca no nome";
    case "sabor ilegível":
      return "Não deu para ler o sabor no nome";
    case "proteína ilegível":
      return "Não deu para ler a proteína no nome";
    case "poucos pares":
      return stores === 1 ? "Só 1 loja vende algo parecido" : `Só ${stores} lojas vendem algo parecido`;
    case "nenhuma loja com os mesmos atributos":
      return "Nenhuma loja vende exatamente o mesmo";
    default:
      // M1-04 Stage 2: "tamanho presumido 500 ml" when a pair rests on a default size.
      if (pairNote?.startsWith("tamanho presumido ")) return `Não deu para ler o tamanho no nome; supomos ${pairNote.slice("tamanho presumido ".length)}`;
      return "Parecido, mas não temos certeza";
  }
}

// P21 time range (draft §2.5) ---------------------------------------------------------------------------------------

export interface PaceInput {
  step: "discover" | "capture" | "pair" | "calc" | "ready";
  /** Slots still needed before pairing may run: quorum.required minus quorum.finished, at least 0. */
  remaining: number;
  running: number;
  finishedSinceStart: number;
  finishedInWindow: number;
  windowMinutes: number;
  typicalSeconds: number;
  maxRunning: number;
  latestRetryAt: Date | null;
  lastFinishedAt: Date | null;
  startedAt: Date;
  slowMinutes: number;
  now: Date;
}

export type Eta = { kind: "unknown" } | { kind: "range"; lowMinutes: number; highMinutes: number } | { kind: "done" };

/** Up to 5 minutes under an hour, to 15 above. */
export function roundUpMinutes(m: number): number {
  const step = m < 60 ? 5 : 15;
  return Math.max(step, Math.ceil(m / step) * step);
}

/**
 * Captures per minute: the run's own pace over the window once 3 captures finished, else the typical capture time
 * (m1.capture_typical_seconds) times the captures running now (at least 1, at most m1.extract_max_running).
 */
export function pacePerMinute(p: PaceInput): number {
  if (p.finishedSinceStart >= 3 && p.finishedInWindow > 0) return p.finishedInWindow / p.windowMinutes;
  const lanes = Math.min(Math.max(p.running, 1), p.maxRunning);
  return (lanes * 60) / p.typicalSeconds;
}

/** "cerca de X a Y minutos": low = remaining / pace, high = 1.8 x low or the latest retry, plus 2 to 5 minutes for steps 3 and 4. */
export function etaRange(p: PaceInput): Eta {
  if (p.step === "ready") return { kind: "done" };
  if (p.step === "discover") return { kind: "unknown" };
  if (p.step === "pair" || p.step === "calc") return { kind: "range", lowMinutes: 5, highMinutes: 5 };
  let low = p.remaining / pacePerMinute(p);
  let high = low * 1.8;
  if (p.latestRetryAt) high = Math.max(high, (p.latestRetryAt.getTime() - p.now.getTime()) / 60_000);
  low += 2;
  high += 5;
  return { kind: "range", lowMinutes: roundUpMinutes(low), highMinutes: roundUpMinutes(Math.max(high, low)) };
}

/** "A leitura está mais lenta agora": slots remain and nothing of this run finished for m1.portal_slow_minutes. */
export function isSlow(p: PaceInput): boolean {
  if (p.step !== "capture" || p.remaining <= 0) return false;
  const since = (p.lastFinishedAt ?? p.startedAt).getTime();
  return p.now.getTime() - since > p.slowMinutes * 60_000;
}

/** "cerca de 20 a 40 minutos", "cerca de 1 a 2 horas"; "Costuma levar de 30 minutos a 2 horas." while discovering. */
export function etaText(e: Eta): string | null {
  if (e.kind === "done") return null;
  if (e.kind === "unknown") return "Costuma levar de 30 minutos a 2 horas.";
  const { lowMinutes: lo, highMinutes: hi } = e;
  if (lo >= 60) return `cerca de ${Math.round(lo / 60)} a ${Math.max(Math.round(hi / 60), Math.round(lo / 60) + 1)} horas`;
  if (hi >= 60) return `cerca de ${lo} minutos a ${Math.ceil(hi / 60)} ${Math.ceil(hi / 60) === 1 ? "hora" : "horas"}`;
  return lo === hi ? `cerca de ${lo} minutos` : `cerca de ${lo} a ${hi} minutos`;
}
