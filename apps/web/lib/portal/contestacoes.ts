// P12 / W03 Contestações (design/P12-Contestacoes.dc.html, design/W03-Contestacoes.dc.html, 05 §B, 04 §3,
// D30): the owner's view of the contestations of their kitchens. The owner copies the ready text into
// the app's portal and marks what they did; statuses move only through public.contestation_mark with
// actor kind person, so the owner can never set creditada or prazo_vencido (system only).
import type { Database } from "@margoai/contracts";
import { brl, CHANNEL_LABEL, dayMon, type Channel } from "@/lib/m2/format";
import type { Db } from "@/lib/supabase/admin";
import { isOwnerEvent, seesKitchen, shortKitchen, type OwnerEvent, type Scope } from "./scope";

type Status = Database["public"]["Enums"]["contestation_status"];

export interface OwnerContestation {
  differenceId: string;
  contestationId: string | null;
  rule: string;
  short: string;
  description: string;
  channel: Channel;
  kitchen: string | null;
  amount: number;
  status: Status | null;
  closed: boolean;
  deadline: string | null;
  protocol: string | null;
  markedAt: string | null;
  creditedOn: string | null;
  claimText: string | null;
}

/** Pill key as the drawings name the states. */
export type Pill = "contestar" | "analise" | "creditada" | "negada" | "vencida" | "resposta" | "ok" | "espera";

export const PILL_LABEL: Record<Pill, { w03: string; p12: string }> = {
  contestar: { w03: "a contestar", p12: "a contestar" },
  analise: { w03: "em análise", p12: "contestada · em análise" },
  creditada: { w03: "creditada", p12: "creditada" },
  negada: { w03: "negada", p12: "negada" },
  vencida: { w03: "prazo vencido", p12: "prazo vencido" },
  resposta: { w03: "precisa da sua resposta", p12: "precisa da sua resposta" },
  ok: { w03: "não era erro", p12: "não era erro" },
  espera: { w03: "esperando o próximo repasse", p12: "esperando o próximo repasse" },
};

export const PILL_TONE: Record<Pill, string> = {
  contestar: "bg-danger-bg",
  analise: "bg-sunken",
  creditada: "bg-ok-bg",
  negada: "bg-muted-bg",
  vencida: "bg-muted-bg",
  resposta: "bg-warn-bg",
  ok: "bg-muted-bg",
  espera: "bg-sunken",
};

export function pillOf(r: OwnerContestation): Pill {
  if (r.closed) return "ok";
  switch (r.status) {
    case "a_contestar":
      return "contestar";
    case "contestada":
      return "analise";
    case "creditada":
      return "creditada";
    case "negada":
      return "negada";
    case "prazo_vencido":
      return "vencida";
    case "precisa_resposta":
      return "resposta";
    default:
      return "espera";
  }
}

/** "Prazo ou protocolo" (W03) and the line under the pill (P12). */
export function infoOf(r: OwnerContestation, today: string): { w03: string; p12: string } {
  const sameDay = r.markedAt?.slice(0, 10) === today;
  switch (pillOf(r)) {
    case "contestar":
      return r.deadline ? { w03: `até ${dayMon(r.deadline)}`, p12: `prazo até ${dayMon(r.deadline)}` } : { w03: "", p12: "" };
    case "analise": {
      if (r.protocol) {
        const since = r.markedAt ? ` · desde ${dayMon(r.markedAt.slice(0, 10))}` : "";
        return { w03: `protocolo ${r.protocol}`, p12: `protocolo ${r.protocol}${since}` };
      }
      const t = sameDay || !r.markedAt ? "contestada hoje" : `contestada em ${dayMon(r.markedAt.slice(0, 10))}`;
      return { w03: t, p12: t };
    }
    case "creditada":
      return r.creditedOn
        ? { w03: `voltou em ${dayMon(r.creditedOn)}`, p12: `voltou no repasse de ${dayMon(r.creditedOn)} (conferido por nós)` }
        : { w03: "", p12: "" };
    case "negada":
      return r.protocol ? { w03: `protocolo ${r.protocol}`, p12: `protocolo ${r.protocol}` } : { w03: "", p12: "" };
    case "resposta":
      return { w03: "", p12: "se não foi combinado, dá para contestar" };
    case "ok":
      return { w03: "", p12: "tirada da lista" };
    case "espera":
      return { w03: "", p12: "pode ser só atraso; avisamos se não vier" };
    default:
      return { w03: "", p12: "" };
  }
}

/** "Centro · iFood" */
export const kitchenApp = (r: OwnerContestation) => [r.kitchen ? shortKitchen(r.kitchen) : null, CHANNEL_LABEL[r.channel]].filter(Boolean).join(" · ");

/** The drawn "O que aconteceu": the rule's short text, other apps named (as C16's rowText). */
export function whatHappened(r: OwnerContestation): string {
  const t = r.short || r.description;
  const ch = CHANNEL_LABEL[r.channel];
  return r.channel === "ifood" || t.includes(`(${ch})`) ? t : `${t} (${ch})`;
}

export interface OwnerTotals {
  toContest: number;
  inAnalysis: number;
  back: number;
  needsAnswer: number;
}

/** The four drawn totals: para você contestar, em análise no app, já voltou, precisa da sua resposta. */
export function ownerTotals(rs: OwnerContestation[]): OwnerTotals {
  const t: OwnerTotals = { toContest: 0, inAnalysis: 0, back: 0, needsAnswer: 0 };
  for (const r of rs) {
    const p = pillOf(r);
    if (p === "contestar") t.toContest += r.amount;
    else if (p === "analise") t.inAnalysis += r.amount;
    else if (p === "creditada") t.back += r.amount;
    else if (p === "resposta") t.needsAnswer += r.amount;
  }
  return t;
}

export const money = brl;

const PILL_ORDER: Pill[] = ["analise", "creditada", "contestar", "resposta", "espera", "negada", "vencida", "ok"];

/** Contestations of the account the person may see (A03: own kitchens only), shown and not doubtful. */
export async function loadOwnerContestations(db: Db, accountId: string, scope: Scope): Promise<OwnerContestation[]> {
  const { data, error } = await db
    .from("difference")
    .select(
      "id, rule_id, description, amount_cents, detail, channel_store(channel, kitchen_id, kitchen(name)), contestation(id, status, closed_at, deadline_on, protocol, marked_at, claim_text, ledger_entry(entry_date))",
    )
    .eq("account_id", accountId)
    .eq("shown", true)
    .neq("confidence", "duvidosa");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((d) => seesKitchen(scope, d.channel_store?.kitchen_id ?? null))
    .map((d) => {
      const c = Array.isArray(d.contestation) ? d.contestation[0] : d.contestation;
      const detail = (d.detail ?? {}) as Record<string, unknown>;
      return {
        differenceId: d.id,
        contestationId: c?.id ?? null,
        rule: d.rule_id,
        short: typeof detail.short === "string" ? detail.short : d.description,
        description: d.description,
        channel: d.channel_store!.channel,
        kitchen: d.channel_store?.kitchen?.name ?? null,
        amount: d.amount_cents,
        status: c?.status ?? null,
        closed: !!c?.closed_at,
        deadline: c?.deadline_on ?? null,
        protocol: c?.protocol ?? null,
        markedAt: c?.marked_at ?? null,
        creditedOn: c?.ledger_entry?.entry_date ?? null,
        claimText: c?.claim_text ?? null,
      };
    })
    .sort((a, b) => PILL_ORDER.indexOf(pillOf(a)) - PILL_ORDER.indexOf(pillOf(b)) || b.amount - a.amount);
}

export type MarkResult = { ok: true } | { ok: false; reason: "not_found" | "not_allowed" };

/**
 * Owner buttons (04 §3): ja_contestei (protocol optional), foi_combinado_sim / _nao, foi_negada. The
 * contestation must be of the account and of a kitchen the person sees; contestation_mark checks the
 * transition and writes audit_log with ip and user agent.
 */
export async function markOwnerContestation(
  db: Db,
  accountId: string,
  scope: Scope,
  personId: string,
  contestationId: string,
  event: string,
  protocol: string | null,
  meta: { ip: string | null; userAgent: string | null },
): Promise<MarkResult> {
  if (!isOwnerEvent(event)) return { ok: false, reason: "not_allowed" };
  const { data: c } = await db
    .from("contestation")
    .select("id, difference(channel_store(kitchen_id))")
    .eq("id", contestationId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!c || !seesKitchen(scope, c.difference?.channel_store?.kitchen_id ?? null)) return { ok: false, reason: "not_found" };
  const { error } = await db.rpc("contestation_mark", {
    p_contestation: c.id,
    p_event: event satisfies OwnerEvent,
    p_actor_kind: "person",
    p_actor: personId,
    p_protocol: event === "ja_contestei" ? (protocol?.trim() || undefined) : undefined,
    p_ip: meta.ip ?? undefined,
    p_user_agent: meta.userAgent ?? undefined,
  });
  return error ? { ok: false, reason: "not_allowed" } : { ok: true };
}
