"use server";
// P19 to P22 writes of the M1 owner journey (docs/m1-owner-journey-draft.md), behind m1.portal and m1.raio_x. Each
// action checks the 04 §5 row here (404 otherwise, 05 convention) and calls the audited SQL function, which checks the
// person, the kitchen scope and the plan limits again on the server and writes audit_log (A04). Pages come with the
// screens; these return a result for useActionState instead of redirecting.
import { revalidatePath } from "next/cache";
import { requestMeta } from "@/lib/console/request";
import {
  answerDoubt,
  answerMany,
  confirmSuggestions,
  createMonitor,
  setMonitorPeriod,
  setMonitorStatus,
  undoAnswer,
  type Actor,
} from "@/lib/monitor/commands";
import { monitorDeps } from "@/lib/monitor/deps";
import { refusalText } from "@/lib/monitor/rules";
import { requirePortal } from "@/lib/portal/session";
import { canonicalStoreUrl, storeIdFromUrl } from "@/lib/xray/ifood-url";

const PATH = "/app/raio-x";
const FLAGS = ["m1.portal"] as const;

export type ActionResult<T = void> = { ok: true; value?: T } | { ok: false; error: string };

async function actor(personId: string): Promise<Actor> {
  const meta = await requestMeta();
  return { personId, ip: meta.ip, userAgent: meta.userAgent };
}

function done<T>(r: { ok: true; value?: T } | { ok: false; refusal: Parameters<typeof refusalText>[0] }): ActionResult<T> {
  revalidatePath(PATH, "layout");
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: refusalText(r.refusal) };
}

/** P20 "Começar a acompanhar": "Uma loja minha" (kind own) or "Um concorrente", both by the iFood link (Marlon, 08/nov). */
export async function createMonitorAction(input: {
  url: string;
  kind: "own" | "competitor";
  kitchenId: string | null;
  everyDays: number;
  radiusKm: 2 | 3 | 5;
  categories: string[];
  rules: { exclude_closed?: boolean; exclude_national_chains?: boolean; same_neighborhood_only?: boolean };
}): Promise<ActionResult<{ monitorId: string; xrayId: string; targetKind: "own" | "competitor" }>> {
  const m = await requirePortal({ action: "manage_monitors", flags: FLAGS });
  const externalId = storeIdFromUrl(input.url);
  if (!externalId) return { ok: false, error: refusalText({ code: "bad_store" }) };
  return done(
    await createMonitor(monitorDeps(), await actor(m.personId), {
      accountId: m.account.id,
      externalId,
      url: canonicalStoreUrl(input.url),
      kitchenId: input.kind === "own" ? null : input.kitchenId,
      kind: input.kind,
      everyDays: input.everyDays,
      radiusKm: input.radiusKm,
      categories: input.categories,
      rules: input.rules,
    }),
  );
}

/** P19 "Pausar", "Retomar", "Remover". */
export async function setMonitorStatusAction(monitorId: string, action: "pause" | "resume" | "remove"): Promise<ActionResult<void>> {
  const m = await requirePortal({ action: "manage_monitors", flags: FLAGS });
  return done(await setMonitorStatus(monitorDeps(), await actor(m.personId), monitorId, action));
}

/** P19 "Mudar frequência". */
export async function setMonitorPeriodAction(monitorId: string, everyDays: number): Promise<ActionResult<void>> {
  const m = await requirePortal({ action: "manage_monitors", flags: FLAGS });
  return done(await setMonitorPeriod(monitorDeps(), await actor(m.personId), monitorId, everyDays));
}

/** P22 one item: "Sim, é o mesmo" (marked pair ids) or "Nenhum é o mesmo" (empty). */
export async function answerDoubtAction(itemId: string, acceptedPairIds: string[]): Promise<ActionResult<void>> {
  const m = await requirePortal({ action: "answer_doubts", flags: FLAGS });
  return done(await answerDoubt(monitorDeps(), await actor(m.personId), itemId, acceptedPairIds, true));
}

/** P22 bulk bar over selected items of one run. */
export async function answerManyAction(xrayId: string, answers: { itemId: string; acceptedPairIds: string[] }[]): Promise<ActionResult<void>> {
  const m = await requirePortal({ action: "answer_doubts", flags: FLAGS });
  return done(await answerMany(monitorDeps(), await actor(m.personId), xrayId, answers));
}

/** P22 "Confirmar todas as sugestões" (null) or "Confirmar sugestões dos selecionados". */
export async function confirmSuggestionsAction(xrayId: string, itemIds: string[] | null): Promise<ActionResult<void>> {
  const m = await requirePortal({ action: "answer_doubts", flags: FLAGS });
  return done(await confirmSuggestions(monitorDeps(), await actor(m.personId), xrayId, itemIds));
}

/** P22 undo an answer. */
export async function undoAnswerAction(itemId: string): Promise<ActionResult<void>> {
  const m = await requirePortal({ action: "answer_doubts", flags: FLAGS });
  return done(await undoAnswer(monitorDeps(), await actor(m.personId), itemId));
}

export type StoreLookup = { state: "invalid" } | { state: "unknown" } | { state: "found"; name: string; area: string | null; category: string | null } | { state: "own"; name: string };

/** P20 after a paste: "Loja encontrada: ..." from the public catalog, or "Esta loja é sua". */
export async function lookupStoreAction(url: string): Promise<StoreLookup> {
  const m = await requirePortal({ action: "manage_monitors", flags: FLAGS });
  const id = storeIdFromUrl(url);
  if (!id) return { state: "invalid" };
  const { data: own } = await m.db.from("channel_store").select("name").eq("channel", "ifood").eq("external_id", id).maybeSingle();
  if (own) return { state: "own", name: own.name };
  const s = (await monitorDeps().rpc("monitor_store_lookup", { p_external_id: id })) as { name: string | null; area: string | null; category: string | null; url: string | null } | null;
  return s?.name ? { state: "found", name: s.name, area: s.area, category: s.category } : { state: "unknown" };
}
