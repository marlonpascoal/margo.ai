// Manual WhatsApp queue (06 §7, D36, 04 §9, E05): until the WhatsApp Business Platform, every WhatsApp notice
// is a ready click-to-chat link that a founder sends by hand from the console (a section of C21 Alertas; 05
// is silent on where). Quiet hours hold owner messages: between 22h and 8h São Paulo the link is not offered
// and marking as sent is refused. Only urgent team alerts to the founder on duty are not held (04 §10;
// Marlon, 31/out).
import { TIME_ZONE, dayMonth } from "@/lib/format";
import type { Db } from "@/lib/supabase/admin";
import { isQuietHours, waitsForMorning, whatsappLink } from "./plan";
import type { RequestMeta } from "./store";

export interface ManualRecord {
  id: string;
  account_id: string | null;
  person_id: string | null;
  notice_code: string | null;
  alert_id: string | null;
  /** From the alert the row belongs to; null for owner notices. */
  alert_severity: "urgente" | "medio" | "baixo" | null;
  status: "queued" | "sent" | "failed" | "held_quiet_hours";
  body: string;
  recipient: string | null;
  provider_id: string | null;
  created_at: string;
  manual_sent_at: string | null;
}

export type ManualState = "ready" | "held" | "no_number" | "done";

/** E05: what a founder may do with one manual WhatsApp row now. */
export function manualState(r: Pick<ManualRecord, "status" | "alert_severity" | "recipient" | "manual_sent_at">, now: Date): ManualState {
  if (r.manual_sent_at || r.status === "failed") return "done";
  if (!r.recipient) return "no_number";
  if (waitsForMorning({ channel: "whatsapp_manual", alertSeverity: r.alert_severity }) && isQuietHours(now)) return "held";
  return "ready";
}

export interface ManualRow {
  id: string;
  to: string;
  client: string;
  notice: string;
  text: string;
  since: string;
  state: ManualState;
  link: string | null;
}

const hourMinute = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** C21 queue rows, oldest first. Not drawn: labels short and listed for Marlon. */
export function buildManualRows(
  rows: ManualRecord[],
  names: { people: Map<string, string>; accounts: Map<string, { code: string; name: string }>; notices: Map<string, string>; alerts: Map<string, string> },
  now: Date,
): ManualRow[] {
  return rows.map((r) => {
    const state = manualState(r, now);
    const acc = r.account_id ? names.accounts.get(r.account_id) : undefined;
    const created = new Date(r.created_at);
    return {
      id: r.id,
      to: [r.person_id ? names.people.get(r.person_id) : null, r.recipient].filter(Boolean).join(" · "),
      client: acc ? `${acc.name} (${acc.code})` : "",
      notice: r.notice_code ? (names.notices.get(r.notice_code) ?? r.notice_code) : `Alerta: ${names.alerts.get(r.alert_id ?? "") ?? ""}`,
      text: r.body,
      since: `${dayMonth(created)} ${hourMinute(created)}`,
      state,
      link: state === "ready" && r.recipient ? (r.provider_id?.startsWith("https://wa.me/") ? r.provider_id : whatsappLink(r.recipient, r.body)) : null,
    };
  });
}

const COLUMNS = "id, account_id, person_id, notice_code, alert_id, status, body, recipient, provider_id, created_at, manual_sent_at, alert(severity)";

type ManualSelect = Omit<ManualRecord, "alert_severity"> & { alert: { severity: ManualRecord["alert_severity"] } | null };
const toRecord = ({ alert, ...r }: ManualSelect): ManualRecord => ({ ...r, alert_severity: alert?.severity ?? null });

/** Pending manual WhatsApp rows (not yet marked sent), with the names the table shows. */
export async function loadManualQueue(db: Db, now: Date, limit = 50): Promise<ManualRow[]> {
  const { data, error } = await db
    .from("notification")
    .select(COLUMNS)
    .eq("channel", "whatsapp_manual")
    .is("manual_sent_at", null)
    .in("status", ["queued", "held_quiet_hours", "sent"])
    .order("created_at")
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as ManualSelect[]).map(toRecord);
  const ids = (k: keyof ManualRecord) => [...new Set(rows.map((r) => r[k]).filter((v): v is string => typeof v === "string"))];
  const [people, accounts, notices, alerts] = await Promise.all([
    ids("person_id").length ? db.from("person").select("id, name").in("id", ids("person_id")) : { data: [] },
    ids("account_id").length ? db.from("account").select("id, code, name").in("id", ids("account_id")) : { data: [] },
    db.from("notice_type").select("code, name"),
    ids("alert_id").length ? db.from("alert").select("id, title").in("id", ids("alert_id")) : { data: [] },
  ]);
  return buildManualRows(
    rows,
    {
      people: new Map((people.data ?? []).map((p) => [p.id, p.name])),
      accounts: new Map((accounts.data ?? []).map((a) => [a.id, { code: a.code, name: a.name }])),
      notices: new Map((notices.data ?? []).map((n) => [n.code, n.name])),
      alerts: new Map((alerts.data ?? []).map((a) => [a.id, a.title])),
    },
    now,
  );
}

export const MANUAL_MESSAGES = {
  staffOnly: "Só a equipe da MargoAI marca mensagens de WhatsApp.",
  notFound: "Mensagem não encontrada.",
  held: "Horário de silêncio: a mensagem espera até 8h.",
  noNumber: "Esta pessoa não tem WhatsApp cadastrado.",
  already: "Esta mensagem já foi marcada como enviada.",
} as const;

export type MarkResult = { ok: true } | { ok: false; message: string };

/** 06 §7: a founder sent the message by hand. Staff only (checked here), held rows refused (E05), audited (A04). */
export async function markWhatsAppSent(db: Db, id: string, staffPersonId: string, meta: RequestMeta, now: Date): Promise<MarkResult> {
  const { data: staff } = await db.from("staff").select("person_id").eq("person_id", staffPersonId).maybeSingle();
  if (!staff) return { ok: false, message: MANUAL_MESSAGES.staffOnly };
  const { data: row } = await db.from("notification").select(COLUMNS).eq("id", id).eq("channel", "whatsapp_manual").maybeSingle();
  if (!row) return { ok: false, message: MANUAL_MESSAGES.notFound };
  const r = toRecord(row as ManualSelect);
  const state = manualState(r, now);
  if (state === "held") return { ok: false, message: MANUAL_MESSAGES.held };
  if (state === "no_number") return { ok: false, message: MANUAL_MESSAGES.noNumber };
  if (state === "done") return { ok: false, message: MANUAL_MESSAGES.already };
  const link = r.provider_id ?? whatsappLink(r.recipient!, r.body);
  const { data: updated, error } = await db
    .from("notification")
    .update({ status: "sent", sent_at: r.status === "sent" ? undefined : now.toISOString(), provider_id: link, manual_sent_at: now.toISOString(), manual_sent_by: staffPersonId })
    .eq("id", id)
    .is("manual_sent_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!updated?.length) return { ok: false, message: MANUAL_MESSAGES.already };
  const { error: auditError } = await db.from("audit_log").insert({
    actor_person_id: staffPersonId,
    actor_kind: "staff",
    account_id: r.account_id,
    action: "notification.whatsapp_sent",
    entity: "notification",
    entity_id: id,
    before: { status: r.status, manual_sent_at: null },
    after: { status: "sent", manual_sent_at: now.toISOString() },
    ip: meta.ip,
    user_agent: meta.userAgent,
  });
  if (auditError) throw new Error(auditError.message);
  return { ok: true };
}
