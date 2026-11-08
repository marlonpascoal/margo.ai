// M1 owner journey writes (draft §2, §3). Each is one audited SQL function of migration 20261230000001 that checks the
// actor's permission and the plan limits itself (A04, 04 §5); this file maps refusals and wakes the job the function
// queued (02 §4). Server actions in app/app/raio-x/actions.ts call these after requirePortal and the m1.portal flag.
import { monitorRefusal, type Refusal } from "./rules";

export interface Actor {
  personId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface MonitorDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  /** Wake the worker of a job the SQL function queued (lib/jobs wakeJob); locally nothing is woken. */
  wake(jobId: string, type: "xray_pair" | "xray_calc"): Promise<void>;
  env: "sandbox" | "production";
}

const who = (a: Actor) => ({ p_actor: a.personId, p_ip: a.ip ?? undefined, p_user_agent: a.userAgent ?? undefined });

async function attempt<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; refusal: Refusal }> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    const r = monitorRefusal(e instanceof Error ? e.message : String(e));
    if (r) return { ok: false, refusal: r };
    throw e;
  }
}

export interface NewMonitor {
  accountId: string;
  /** iFood store uuid (D29), from lib/xray/ifood-url storeIdFromUrl. */
  externalId: string;
  url: string;
  /** Competitor: "Perto de qual cozinha?". Own stores take their kitchen on the server. */
  kitchenId: string | null;
  /** P20 choice: "Uma loja minha" sends own (by its link, no channel_store needed), "Um concorrente" competitor. */
  kind?: "own" | "competitor";
  everyDays: number;
  radiusKm: 2 | 3 | 5;
  categories: string[];
  rules: { exclude_closed?: boolean; exclude_national_chains?: boolean; same_neighborhood_only?: boolean };
}

/** P20 "Começar a acompanhar": the monitoring and its first run (discovery queued, extractors poll for it). */
export async function createMonitor(deps: MonitorDeps, actor: Actor, m: NewMonitor) {
  return attempt(async () => {
    const out = (await deps.rpc("monitor_create", {
      p_account: m.accountId,
      p_external_id: m.externalId,
      p_url: m.url,
      // No default in SQL: an own store (or a competitor without a kitchen) sends null, never omits it.
      p_kitchen: m.kitchenId,
      p_every_days: m.everyDays,
      p_radius_km: m.radiusKm,
      p_categories: m.categories,
      p_rules: m.rules,
      p_env: deps.env,
      ...who(actor),
      p_kind: m.kind ?? null,
    })) as { monitor_id: string; xray_id: string; target_kind: "own" | "competitor" };
    return { monitorId: out.monitor_id, xrayId: out.xray_id, targetKind: out.target_kind };
  });
}

/** P19 row menu: "Pausar", "Retomar", "Remover" (the history stays). */
export async function setMonitorStatus(deps: MonitorDeps, actor: Actor, monitorId: string, action: "pause" | "resume" | "remove") {
  return attempt(async () => {
    await deps.rpc("monitor_set_status", { p_monitor: monitorId, p_action: action, p_env: deps.env, ...who(actor) });
  });
}

/** P19 "Mudar frequência". */
export async function setMonitorPeriod(deps: MonitorDeps, actor: Actor, monitorId: string, everyDays: number) {
  return attempt(async () => {
    await deps.rpc("monitor_set_period", { p_monitor: monitorId, p_every_days: everyDays, ...who(actor) });
  });
}

async function calcQueued(deps: MonitorDeps, jobId: unknown) {
  if (typeof jobId === "string") await deps.wake(jobId, "xray_calc");
}

/** P22 one item: "Sim, é o mesmo" with the marked candidates (xray_pair ids), or "Nenhum é o mesmo" (empty list).
 * ifUnanswered refuses when another person answered first ("Outra pessoa já respondeu este item"). */
export async function answerDoubt(deps: MonitorDeps, actor: Actor, itemId: string, acceptedPairIds: string[], ifUnanswered = true) {
  return attempt(async () => {
    await calcQueued(deps, await deps.rpc("monitor_answer", { p_item: itemId, p_accepted: acceptedPairIds, p_if_unanswered: ifUnanswered, ...who(actor) }));
  });
}

/** P22 bulk bar: several items of one run, one recalculation. "Nenhum é o mesmo nos selecionados" passes empty lists. */
export async function answerMany(deps: MonitorDeps, actor: Actor, xrayId: string, answers: { itemId: string; acceptedPairIds: string[] }[]) {
  return attempt(async () => {
    const payload = answers.map((a) => ({ item: a.itemId, accepted: a.acceptedPairIds }));
    await calcQueued(deps, await deps.rpc("monitor_answer_many", { p_xray: xrayId, p_answers: payload, ...who(actor) }));
  });
}

/** P22 "Confirmar todas as sugestões" (itemIds null) or "Confirmar sugestões dos selecionados". */
export async function confirmSuggestions(deps: MonitorDeps, actor: Actor, xrayId: string, itemIds: string[] | null) {
  return attempt(async () => {
    await calcQueued(deps, await deps.rpc("monitor_confirm_suggestions", { p_xray: xrayId, p_items: itemIds, ...who(actor) }));
  });
}

/** Undo an answer: forgotten by the monitoring, the run pairs the item again by the rules and recalculates. */
export async function undoAnswer(deps: MonitorDeps, actor: Actor, itemId: string) {
  return attempt(async () => {
    const jobId = await deps.rpc("monitor_undo", { p_item: itemId, ...who(actor) });
    if (typeof jobId === "string") await deps.wake(jobId, "xray_pair");
  });
}
