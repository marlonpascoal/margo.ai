// C16 Contestação (design/C16-Contestacao.dc.html, 05 §A, 04 §3, D30): status totals, the table with who
// marked and the next step, the ready claim text and the order sheet. Statuses move only through
// public.contestation_mark; staff may mark negada and never creditada.
import type { Database } from "@margoai/contracts";
import type { Db } from "@/lib/supabase/admin";
import type { M2Account } from "./account";
import { brl, CHANNEL_LABEL, dayMon, type Channel } from "./format";

type Status = Database["public"]["Enums"]["contestation_status"];

export interface ContestationRecord {
  differenceId: string;
  contestationId: string | null;
  rule: string;
  short: string;
  description: string;
  channel: Channel;
  amount: number;
  orders: number;
  confidence: Database["public"]["Enums"]["difference_confidence"];
  status: Status | null;
  closed: boolean;
  deadline: string | null;
  protocol: string | null;
  markedKind: Database["public"]["Enums"]["actor_kind"] | null;
  markedRole: string | null;
  markedAt: string | null;
  creditedOn: string | null;
  claimText: string | null;
  reopenAfter: string | null;
}

/** What C16 shows for each record: "em análise", "esperando repasse", ... and its tone. */
export type Tone = "contestar" | "analise" | "creditada" | "resposta" | "espera" | "fim";

export function statusView(r: ContestationRecord): { label: string; tone: Tone } {
  if (r.closed) return { label: "não era erro", tone: "fim" };
  switch (r.status) {
    case "a_contestar":
      return { label: "a contestar", tone: "contestar" };
    case "contestada":
      return { label: "em análise", tone: "analise" };
    case "creditada":
      return { label: "creditada", tone: "creditada" };
    case "precisa_resposta":
      return { label: "resposta do dono", tone: "resposta" };
    case "negada":
      return { label: "negada", tone: "fim" };
    case "prazo_vencido":
      return { label: "prazo vencido", tone: "fim" };
    default:
      return { label: "esperando repasse", tone: "espera" };
  }
}

/** "Quem marcou": "dono, 02/out · protocolo 48213", "MargoAI, repasse de 14/out", "MargoAI". */
export function whoMarked(r: ContestationRecord): string {
  if (r.status === "creditada") return `MargoAI, repasse de ${r.creditedOn ? dayMon(r.creditedOn) : ""}`;
  if (!r.status) return "MargoAI";
  if (!r.markedKind) return "";
  const who = r.markedKind === "system" ? "MargoAI" : r.markedKind === "staff" ? "equipe" : (r.markedRole ?? "dono");
  const when = r.markedAt ? `, ${dayMon(r.markedAt.slice(0, 10))}` : "";
  return `${who}${when}${r.protocol ? ` · protocolo ${r.protocol}` : ""}`;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** "Próximo passo". Three days before the deadline the owner gets deadline_soon (04 §9): "lembrar o dono". */
export function nextStep(r: ContestationRecord, today: string): string {
  if (r.closed) return "nada";
  switch (r.status) {
    case "a_contestar": {
      if (!r.deadline) return "";
      const soon = daysBetween(today, r.deadline) <= 3 ? " · lembrar o dono" : "";
      return `prazo ${dayMon(r.deadline)}${soon}`;
    }
    case "contestada":
      return "conferir o próximo repasse";
    case "precisa_resposta":
      return "dono confirma se combinou";
    case "creditada":
    case "negada":
    case "prazo_vencido":
      return "nada";
    default:
      return r.reopenAfter ? `reabrir se não vier até ${dayMon(r.reopenAfter)}` : "esperar o próximo repasse";
  }
}

export interface StatusTotals {
  toContest: number;
  contested: number;
  credited: number;
  denied: number;
  waiting: number;
}

/** The five totals as drawn: a contestar, contestada em análise, creditada, negada, esperando o dono ou o repasse. */
export function totals(rs: ContestationRecord[]): StatusTotals {
  const t: StatusTotals = { toContest: 0, contested: 0, credited: 0, denied: 0, waiting: 0 };
  for (const r of rs) {
    if (r.closed) continue;
    if (r.status === "a_contestar") t.toContest += r.amount;
    else if (r.status === "contestada") t.contested += r.amount;
    else if (r.status === "creditada") t.credited += r.amount;
    else if (r.status === "negada") t.denied += r.amount;
    else if (r.status === "precisa_resposta" || r.status === null) t.waiting += r.amount;
  }
  return t;
}

/** C16 row label: the rule's short text; channels other than iFood are named, as drawn ("(99Food)"). */
export function rowText(r: ContestationRecord): string {
  const t = r.short || r.description;
  const ch = CHANNEL_LABEL[r.channel];
  return r.channel === "ifood" || t.includes(`(${ch})`) ? t : `${t} (${ch})`;
}

/** "Texto pronto · DIF-03, cupom cofinanciado": the rule and the start of what happened, lower case. */
export function claimTitle(r: ContestationRecord): string {
  const words = r.short.toLowerCase().split(" ").slice(0, 2).join(" ");
  return `Texto pronto · ${r.rule}, ${words}`;
}

/** Click-to-chat link to the Dono with the claim text (D36: WhatsApp is manual until the platform). */
export function whatsappLink(phoneE164: string | null, text: string): string | null {
  if (!phoneE164) return null;
  return `https://wa.me/${phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/** Every difference of the account that the owner side can act on (shown, not doubtful), newest month first. */
export async function loadContestations(db: Db, account: M2Account): Promise<ContestationRecord[]> {
  const { data, error } = await db
    .from("difference")
    .select(
      "id, rule_id, description, orders_count, amount_cents, confidence, detail, close_period(month), channel_store(channel), contestation(id, status, closed_at, deadline_on, protocol, marked_by, marked_by_kind, marked_at, claim_text, ledger_entry(entry_date))",
    )
    .eq("account_id", account.id)
    .eq("shown", true)
    .neq("confidence", "duvidosa");
  if (error) throw new Error(error.message);
  const roles = new Map<string, string>();
  const { data: ms } = await db.from("membership").select("person_id, role").eq("account_id", account.id);
  for (const m of ms ?? []) roles.set(m.person_id, m.role);
  const out = (data ?? []).map((d) => {
    const c = Array.isArray(d.contestation) ? d.contestation[0] : d.contestation;
    const detail = (d.detail ?? {}) as Record<string, unknown>;
    return {
      differenceId: d.id,
      contestationId: c?.id ?? null,
      rule: d.rule_id,
      short: typeof detail.short === "string" ? detail.short : d.description,
      description: d.description,
      channel: d.channel_store!.channel,
      amount: d.amount_cents,
      orders: d.orders_count,
      confidence: d.confidence,
      status: c?.status ?? null,
      closed: !!c?.closed_at,
      deadline: c?.deadline_on ?? null,
      protocol: c?.protocol ?? null,
      markedKind: c?.marked_by_kind ?? null,
      markedRole: c?.marked_by ? (roles.get(c.marked_by) ?? null) : null,
      markedAt: c?.marked_at ?? null,
      creditedOn: c?.ledger_entry?.entry_date ?? null,
      claimText: c?.claim_text ?? null,
      reopenAfter: typeof detail.reopen_after === "string" ? detail.reopen_after : null,
      month: d.close_period?.month ?? "",
    };
  });
  return out
    .sort((a, b) => b.month.localeCompare(a.month) || Number(a.confidence !== "certa") - Number(b.confidence !== "certa") || b.amount - a.amount)
    .map(({ month: _month, ...r }) => r);
}

/** The first difference waiting for the owner to contest is the one whose text shows by default. */
export function defaultSelection(rs: ContestationRecord[]): ContestationRecord | undefined {
  return rs.find((r) => r.status === "a_contestar" && !r.closed && r.claimText) ?? rs.find((r) => r.claimText);
}

export const channelSuffix = (r: ContestationRecord) => CHANNEL_LABEL[r.channel];
export const money = brl;
