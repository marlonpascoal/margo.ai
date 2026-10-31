// What the notifier needs from the database. SupabaseNotifyStore implements it; tests use fakes.
import type { ChannelPref, NoticeType, NotificationChannel, NotificationStatus, PlannedNotification, Recipient, Role } from "./plan";

export type AlertSeverity = "urgente" | "medio" | "baixo";

export interface OutboxRow {
  id: string;
  accountId: string | null;
  personId: string | null;
  noticeCode: string | null;
  alertId: string | null;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  status: NotificationStatus;
  recipient: string | null;
  html?: string | null;
  attachmentPath?: string | null;
}

export interface AlertRow {
  id: string;
  severity: AlertSeverity;
  title: string;
  accountId: string | null;
  link: string | null;
  notifiedVia: string[];
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

export interface AuditEntry {
  actorPersonId: string | null;
  actorKind: "person" | "staff" | "system";
  accountId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
}

/** Who made a request; ip and user agent go to audit_log (02 §5). */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface NotifyStore {
  noticeType(code: string): Promise<NoticeType | null>;
  /** Members of the account with one of these roles, with their contacts. */
  audience(accountId: string, roles: Role[]): Promise<Recipient[]>;
  /** Stored preferences of these people for one notice, by person id. */
  prefs(accountId: string, noticeCode: string, personIds: string[]): Promise<Map<string, ChannelPref>>;
  insertNotifications(rows: PlannedNotification[]): Promise<string[]>;
  /** Queued and held rows, oldest first. */
  outbox(limit: number): Promise<OutboxRow[]>;
  contact(personId: string): Promise<{ email: string | null; whatsappE164: string | null } | null>;
  /** Moves a row only if it still has status `from`; false when another run got there first. */
  setStatus(id: string, from: NotificationStatus, to: NotificationStatus, sent?: { at: Date; providerId: string }): Promise<boolean>;

  membershipRole(personId: string, accountId: string): Promise<Role | null>;
  savePref(personId: string, accountId: string, noticeCode: string, pref: ChannelPref): Promise<string>;

  isStaff(personId: string): Promise<boolean>;
  /** Staff person found by e-mail, for the founder on duty. */
  staffByEmail(email: string): Promise<{ personId: string; whatsappE164: string | null } | null>;
  accountLabel(accountId: string): Promise<string | null>;
  findOpenAlert(severity: AlertSeverity, title: string, accountId: string | null): Promise<string | null>;
  insertAlert(row: { severity: AlertSeverity; title: string; accountId: string | null; link: string | null; notifiedVia: string[]; openedAt: Date }): Promise<string>;
  getAlert(id: string): Promise<AlertRow | null>;
  /** Sets resolved_at and resolved_by only on an open alert; false when it was already resolved. */
  resolveAlert(id: string, personId: string, at: Date): Promise<boolean>;

  audit(entries: AuditEntry[]): Promise<void>;
}
