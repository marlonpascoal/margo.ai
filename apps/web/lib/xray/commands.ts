// M1 console writes (05 C02 to C06). Each goes through an audited SQL function that checks the actor is
// staff and writes audit_log in the same transaction (migration 20261104000011, A04), then enqueues the
// worker job when the step has one (02 §4). Pages call these from server actions after requireConsole.
import { CATEGORY_OPTIONS, RADIUS_OPTIONS } from "./labels";
import { canonicalStoreUrl, storeIdFromUrl } from "./ifood-url";

export interface Actor {
  personId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface XrayDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  /** Flag environment for the m1.concorrente check in xray_create (04 §6, MARGO_FLAG_ENV). */
  env?: "sandbox" | "production";
  enqueue(job: { type: string; payload: Record<string, unknown>; accountId: string | null; dedupeKey: string }): Promise<void>;
}

const who = (a: Actor) => ({ p_actor: a.personId, p_ip: a.ip ?? undefined, p_user_agent: a.userAgent ?? undefined });

export interface NewXray {
  url: string;
  radiusKm: number;
  category: string;
  excludeClosed: boolean;
  excludeChains: boolean;
  sameNeighborhoodOnly: boolean;
  /** The account the X-ray is for (C02 ?conta=). Absent: the owner of the store, else a lead. */
  accountId?: string | null;
}

export type CreateResult =
  | { ok: true; xrayId: string }
  | { ok: false; field: "url" | "form" | "account" }
  /** B01 competitor X-ray refused by xray_create (migration 20261212000001): limit 0 when not in the plan. */
  | { ok: false; field: "competitor"; limit: number };

/** The refusals xray_create raises for a competitor X-ray or an unknown account; anything else is rethrown. */
function createRefusal(e: unknown): CreateResult | null {
  const m = e instanceof Error ? e.message : "";
  if (m === "competitor_xray_not_in_plan") return { ok: false, field: "competitor", limit: 0 };
  const lim = /^competitor_xray_limit:(\d+)$/.exec(m);
  if (lim) return { ok: false, field: "competitor", limit: Number(lim[1]) };
  if (m === "unknown account") return { ok: false, field: "account" };
  return null;
}

/** C02 "Buscar vizinhança": the X-ray (collecting) and its collect job (D47). For an account, a target that is
 * not one of its stores is a competitor X-ray: flag m1.concorrente and the plan's monthly limit, checked by
 * xray_create on the server. */
export async function createXray(deps: XrayDeps, actor: Actor, input: NewXray, accountOf: (externalId: string) => Promise<string | null>): Promise<CreateResult> {
  const externalId = storeIdFromUrl(input.url);
  if (!externalId) return { ok: false, field: "url" };
  const category = CATEGORY_OPTIONS.find((c) => c.value === input.category);
  if (!category || !RADIUS_OPTIONS.some((r) => r.value === input.radiusKm)) return { ok: false, field: "form" };
  const forAccount = input.accountId ? { p_account: input.accountId, p_env: deps.env ?? "sandbox" } : {};
  let xrayId: string;
  try {
    xrayId = (await deps.rpc("xray_create", {
      p_external_id: externalId,
      p_url: canonicalStoreUrl(input.url),
      p_radius_km: input.radiusKm,
      p_categories: [...category.categories],
      p_rules: {
        exclude_closed: input.excludeClosed,
        exclude_national_chains: input.excludeChains,
        same_neighborhood_only: input.sameNeighborhoodOnly,
      },
      ...who(actor),
      ...forAccount,
    })) as string;
  } catch (e) {
    const refused = createRefusal(e);
    if (refused) return refused;
    throw e;
  }
  const accountId = input.accountId || (await accountOf(externalId));
  await deps.enqueue({ type: "collect", payload: { xray_id: xrayId }, accountId, dedupeKey: `collect:${xrayId}` });
  return { ok: true, xrayId };
}

/** C03 toggle: a store in or out of the set (reason "manual"). */
export async function setStoreIncluded(deps: XrayDeps, actor: Actor, xrayStoreId: string, included: boolean): Promise<void> {
  await deps.rpc("xray_store_set_included", { p_xray_store: xrayStoreId, p_included: included, ...who(actor) });
}

/** C03 "Confirmar N lojas": pairing starts (xray_pair job). */
export async function confirmStores(deps: XrayDeps, actor: Actor, xrayId: string, accountId: string | null): Promise<void> {
  await deps.rpc("xray_confirm_stores", { p_xray: xrayId, ...who(actor) });
  await deps.enqueue({ type: "xray_pair", payload: { xray_id: xrayId }, accountId, dedupeKey: `xray_pair:${xrayId}` });
}

/** C04: the accepted pairs of one item; the item counts as reviewed. */
export async function reviewItem(deps: XrayDeps, actor: Actor, itemId: string, acceptedPairIds: string[]): Promise<void> {
  await deps.rpc("xray_item_review", { p_item: itemId, p_accepted: acceptedPairIds, ...who(actor) });
}

/** C04: leave an item out of the calculation (listed in the PDF footnote), or bring it back. */
export async function setItemSkipped(deps: XrayDeps, actor: Actor, itemId: string, skipped: boolean): Promise<void> {
  await deps.rpc("xray_item_set_skipped", { p_item: itemId, p_skipped: skipped, ...who(actor) });
}

/** C04 "Calcular raio-X" (xray_calc job). */
export async function calculate(deps: XrayDeps, actor: Actor, xrayId: string, accountId: string | null): Promise<void> {
  await deps.rpc("xray_calculate", { p_xray: xrayId, ...who(actor) });
  await deps.enqueue({ type: "xray_calc", payload: { xray_id: xrayId }, accountId, dedupeKey: `xray_calc:${xrayId}` });
}

/** C05 "Preparar entrega": P01 by worker-render (render_xray job). */
export async function prepareDelivery(deps: XrayDeps, actor: Actor, xrayId: string, accountId: string | null): Promise<void> {
  await deps.rpc("xray_prepare_delivery", { p_xray: xrayId, ...who(actor) });
  await deps.enqueue({ type: "render_xray", payload: { xray_id: xrayId }, accountId, dedupeKey: `render_xray:${xrayId}` });
}

/** C06 "Enviar pelo WhatsApp": the X-ray is delivered; the text is kept in the audit log. */
export async function markDelivered(deps: XrayDeps, actor: Actor, xrayId: string, message: string): Promise<void> {
  await deps.rpc("xray_mark_delivered", { p_xray: xrayId, p_message: message, ...who(actor) });
}

/** C06 "Salvar e voltar": minutes per step (time_log). */
export async function saveMinutes(deps: XrayDeps, actor: Actor, xrayId: string, minutes: Record<string, number>): Promise<void> {
  await deps.rpc("time_log_save", { p_xray: xrayId, p_minutes: minutes, ...who(actor) });
}
