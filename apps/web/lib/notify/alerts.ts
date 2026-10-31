// Team alerts (04 §10, C21, D36): e-mail to the team; urgente also WhatsApp to the founder on duty.
// Alerts stay open until someone from staff resolves them.
import { WHATSAPP_CHANNEL, type PlannedNotification } from "./plan";
import type { NotifyDeps } from "./outbox";
import type { AlertSeverity, RequestMeta } from "./store";

export interface AlertConfig {
  /** C21: "e-mail para alertas@margoai.com". */
  teamEmail: string;
  /** E-mail of the staff person on duty; their WhatsApp gets urgente alerts. Null: nobody configured. */
  founderOnDutyEmail: string | null;
}

export const DEFAULT_TEAM_EMAIL = "alertas@margoai.com";

/** MARGO_TEAM_EMAIL and MARGO_FOUNDER_ON_DUTY (an e-mail), set on the platform (D44). */
export function alertConfigFromEnv(env: Record<string, string | undefined> = process.env): AlertConfig {
  return { teamEmail: env.MARGO_TEAM_EMAIL || DEFAULT_TEAM_EMAIL, founderOnDutyEmail: env.MARGO_FOUNDER_ON_DUTY || null };
}

export type NotifiedVia = "team_email" | "founder_whatsapp";

/** C21 "Avisado por" column, as drawn. */
export function notifiedViaLabel(via: string[]): string {
  return via.includes("founder_whatsapp") ? "e-mail e WhatsApp da equipe" : "e-mail da equipe";
}

export const SEVERITY_LABEL: Record<AlertSeverity, string> = { urgente: "urgente", medio: "médio", baixo: "baixo" };

export const ALERT_MESSAGES = {
  // Not drawn; same style as C21.
  staffOnly: "Só a equipe da MargoAI resolve alertas.",
  notFound: "Alerta não encontrado.",
  alreadyResolved: "Este alerta já foi resolvido.",
} as const;

/** Not drawn. Plain text, no em dashes. */
function teamEmail(severity: AlertSeverity, title: string, client: string | null, link: string | null) {
  const lines = [title];
  if (client) lines.push(`Cliente: ${client}`);
  if (link) lines.push(`Abrir: ${link}`);
  lines.push("", "O alerta fica em Alertas até alguém da equipe resolver.");
  return { subject: `Alerta ${SEVERITY_LABEL[severity]}: ${title}`, body: lines.join("\n") };
}

function founderText(title: string, client: string | null, link: string | null) {
  return [`Alerta urgente na MargoAI: ${title}.`, client ? `Cliente: ${client}.` : null, link].filter(Boolean).join(" ");
}

/**
 * 04 §10: opens an alert and queues the team messages. An open alert with the same severity, title and
 * client is not raised again, so a daily job does not repeat it.
 */
export async function raiseAlert(
  deps: NotifyDeps & { config: AlertConfig },
  severity: AlertSeverity,
  title: string,
  accountId: string | null,
  link: string | null,
): Promise<{ id: string; created: boolean }> {
  const { store, config } = deps;
  const open = await store.findOpenAlert(severity, title, accountId);
  if (open) return { id: open, created: false };

  const founder = severity === "urgente" && config.founderOnDutyEmail ? await store.staffByEmail(config.founderOnDutyEmail) : null;
  const viaWhatsApp = founder?.whatsappE164 ? founder : null;
  const notifiedVia: NotifiedVia[] = viaWhatsApp ? ["team_email", "founder_whatsapp"] : ["team_email"];

  const id = await store.insertAlert({ severity, title, accountId, link, notifiedVia, openedAt: deps.now() });
  const client = accountId ? await store.accountLabel(accountId) : null;
  const mail = teamEmail(severity, title, client, link);
  const base = { accountId, noticeCode: null, alertId: id, status: "queued" as const };
  const rows: PlannedNotification[] = [
    { ...base, personId: null, channel: "email", subject: mail.subject, body: mail.body, recipient: config.teamEmail },
  ];
  if (viaWhatsApp) {
    rows.push({
      ...base,
      personId: viaWhatsApp.personId,
      channel: WHATSAPP_CHANNEL,
      subject: null,
      body: founderText(title, client, link),
      recipient: viaWhatsApp.whatsappE164,
    });
  }
  await store.insertNotifications(rows);
  return { id, created: true };
}

export type ResolveResult = { ok: true } | { ok: false; message: string };

/** C21 "resolver": staff only (checked here, server-side); writes resolved_at, resolved_by and audit_log. */
export async function resolveAlert(deps: NotifyDeps, alertId: string, personId: string, meta: RequestMeta): Promise<ResolveResult> {
  const { store } = deps;
  if (!(await store.isStaff(personId))) return { ok: false, message: ALERT_MESSAGES.staffOnly };
  const alert = await store.getAlert(alertId);
  if (!alert) return { ok: false, message: ALERT_MESSAGES.notFound };
  if (alert.resolvedAt) return { ok: false, message: ALERT_MESSAGES.alreadyResolved };
  const at = deps.now();
  if (!(await store.resolveAlert(alertId, personId, at))) return { ok: false, message: ALERT_MESSAGES.alreadyResolved };
  await store.audit([
    {
      actorPersonId: personId,
      actorKind: "staff",
      accountId: alert.accountId,
      action: "alert.resolve",
      entity: "alert",
      entityId: alertId,
      before: { resolved_at: null, resolved_by: null },
      after: { resolved_at: at.toISOString(), resolved_by: personId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  ]);
  return { ok: true };
}
