// Notification rules (04 §9, D36, E05). Pure functions; callers pass the clock.

export type Role = "dono" | "financeiro" | "gerente";
export type NotificationChannel = "email" | "whatsapp" | "whatsapp_manual";
export type NotificationStatus = "queued" | "sent" | "failed" | "held_quiet_hours";

export const TIME_ZONE = "America/Sao_Paulo";
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;
/** Until the WhatsApp Business Platform (D24, D36), every WhatsApp notice is sent by hand by a founder. */
export const WHATSAPP_CHANNEL: NotificationChannel = "whatsapp_manual";

/** A row of notice_type. */
export interface NoticeType {
  code: string;
  name: string;
  audienceRoles: Role[];
  emailLocked: boolean;
  defaultEmail: boolean;
  defaultWhatsapp: boolean;
}

/** A row of notice_pref, or the effective choice. */
export interface ChannelPref {
  email: boolean;
  whatsapp: boolean;
}

/** A member of the account the notice is about, with the contacts the notice can use. */
export interface Recipient {
  personId: string;
  accountId: string;
  accountName: string;
  role: Role;
  email: string | null;
  whatsappE164: string | null;
}

/** What a template produces (apps/web/lib/notify/templates.ts). */
export interface NoticeMessage {
  subject: string;
  body: string;
  /** WhatsApp text; the e-mail body when absent. */
  whatsapp?: string;
}

/** A notification row to insert. */
export interface PlannedNotification {
  accountId: string | null;
  personId: string | null;
  noticeCode: string | null;
  alertId: string | null;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  status: NotificationStatus;
  recipient: string | null;
}

const hourFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" });

/** Hour of the day (0 to 23) in São Paulo. */
export function saoPauloHour(now: Date): number {
  return Number(hourFormat.format(now));
}

/** 04 §9: no WhatsApp between 22h and 8h São Paulo. */
export function isQuietHours(now: Date): boolean {
  const h = saoPauloHour(now);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** E05: the person's choice, or the notice default; locked notices always go by e-mail. */
export function effectivePref(notice: NoticeType, pref: ChannelPref | null): ChannelPref {
  return {
    email: notice.emailLocked || (pref?.email ?? notice.defaultEmail),
    whatsapp: pref?.whatsapp ?? notice.defaultWhatsapp,
  };
}

/** E05: the rows one notice becomes for one person. Empty when the person is not in its audience. */
export function planNotice(
  notice: NoticeType,
  to: Recipient,
  pref: ChannelPref | null,
  message: NoticeMessage,
  now: Date,
): PlannedNotification[] {
  if (!notice.audienceRoles.includes(to.role)) return [];
  const want = effectivePref(notice, pref);
  const base = { accountId: to.accountId, personId: to.personId, noticeCode: notice.code, alertId: null };
  const rows: PlannedNotification[] = [];
  if (want.email && to.email) {
    rows.push({ ...base, channel: "email", subject: message.subject, body: message.body, status: "queued", recipient: to.email });
  }
  if (want.whatsapp && to.whatsappE164) {
    rows.push({
      ...base,
      channel: WHATSAPP_CHANNEL,
      subject: null,
      body: message.whatsapp ?? message.body,
      status: isQuietHours(now) ? "held_quiet_hours" : "queued",
      recipient: to.whatsappE164,
    });
  }
  return rows;
}

/** D36: click-to-chat link a founder opens to send the message by hand. */
export function whatsappLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
