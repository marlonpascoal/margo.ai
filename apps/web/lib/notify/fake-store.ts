// In-memory NotifyStore for unit tests. SupabaseNotifyStore has its own integration test.
import type { ChannelPref, NoticeType, NotificationStatus, PlannedNotification, Role } from "./plan";
import type { AlertRow, AlertSeverity, AuditEntry, NotifyStore, OutboxRow } from "./store";

export const NOTICE_TYPES: NoticeType[] = [
  ["close_ready", "Fechamento do mês pronto", ["dono", "financeiro"], false, true, true],
  ["new_difference", "Diferença nova no repasse", ["dono", "financeiro"], false, true, false],
  ["deadline_soon", "Prazo de contestação chegando", ["dono", "financeiro"], false, true, true],
  ["credit_confirmed", "Crédito confirmado no repasse", ["dono", "financeiro"], false, true, false],
  ["data_stale", "Dados parados", ["dono"], false, true, true],
  ["invoices_missing", "Notas faltando", ["dono", "financeiro"], false, false, true],
  ["weekly_summary", "Resumo da semana", ["dono", "financeiro", "gerente"], false, true, false],
  ["trial_ending", "Teste grátis acabando", ["dono"], true, true, true],
  ["billing_result", "Cobrança aprovada ou recusada", ["dono"], true, true, false],
  ["security_event", "Pessoa nova ou login em aparelho novo", ["dono"], true, true, false],
  ["xray_ready", "Seu raio-X está pronto", ["dono", "gerente"], false, true, true],
  ["xray_needs_answer", "Itens esperando sua resposta", ["dono", "gerente"], false, true, false],
].map(([code, name, audienceRoles, emailLocked, defaultEmail, defaultWhatsapp]) => ({
  code, name, audienceRoles, emailLocked, defaultEmail, defaultWhatsapp,
}) as NoticeType);

export interface FakePerson {
  id: string;
  name: string;
  email: string | null;
  whatsappE164: string | null;
  staff?: boolean;
  memberships: { accountId: string; role: Role }[];
}

export class FakeNotifyStore implements NotifyStore {
  accounts = new Map<string, string>();
  people: FakePerson[] = [];
  prefRows: { id: string; personId: string; accountId: string; noticeCode: string; pref: ChannelPref }[] = [];
  notifications: (OutboxRow & { sentAt: Date | null; providerId: string | null })[] = [];
  alerts: (AlertRow & { openedAt: Date })[] = [];
  audits: AuditEntry[] = [];
  private seq = 0;
  private nextId = (p: string) => `${p}-${++this.seq}`;

  async noticeType(code: string) { return NOTICE_TYPES.find((t) => t.code === code) ?? null; }

  async audience(accountId: string, roles: Role[]) {
    return this.people.flatMap((p) =>
      p.memberships
        .filter((m) => m.accountId === accountId && roles.includes(m.role))
        .map((m) => ({ personId: p.id, accountId, accountName: this.accounts.get(accountId)!, role: m.role, email: p.email, whatsappE164: p.whatsappE164 })),
    );
  }

  async prefs(accountId: string, noticeCode: string, personIds: string[]) {
    return new Map(
      this.prefRows
        .filter((r) => r.accountId === accountId && r.noticeCode === noticeCode && personIds.includes(r.personId))
        .map((r) => [r.personId, r.pref]),
    );
  }

  async insertNotifications(rows: PlannedNotification[]) {
    return rows.map((r) => {
      const id = this.nextId("n");
      this.notifications.push({ id, ...r, sentAt: null, providerId: null });
      return id;
    });
  }

  async outbox(limit: number) {
    return this.notifications.filter((n) => n.status === "queued" || n.status === "held_quiet_hours").slice(0, limit)
      .map((n) => ({ ...n, alertSeverity: this.alerts.find((a) => a.id === n.alertId)?.severity ?? null }));
  }

  async contact(personId: string) {
    const p = this.people.find((x) => x.id === personId);
    return p ? { email: p.email, whatsappE164: p.whatsappE164 } : null;
  }

  async setStatus(id: string, from: NotificationStatus, to: NotificationStatus, sent?: { at: Date; providerId: string }) {
    const n = this.notifications.find((x) => x.id === id);
    if (!n || n.status !== from) return false;
    n.status = to;
    if (sent) { n.sentAt = sent.at; n.providerId = sent.providerId; }
    return true;
  }

  async membershipRole(personId: string, accountId: string) {
    return this.people.find((p) => p.id === personId)?.memberships.find((m) => m.accountId === accountId)?.role ?? null;
  }

  async savePref(personId: string, accountId: string, noticeCode: string, pref: ChannelPref) {
    const t = NOTICE_TYPES.find((x) => x.code === noticeCode)!;
    if (t.emailLocked && !pref.email) throw new Error(`notice ${noticeCode} is always sent by e-mail`); // the trigger
    const row = this.prefRows.find((r) => r.personId === personId && r.accountId === accountId && r.noticeCode === noticeCode);
    if (row) { row.pref = pref; return row.id; }
    const id = this.nextId("pref");
    this.prefRows.push({ id, personId, accountId, noticeCode, pref });
    return id;
  }

  async isStaff(personId: string) { return !!this.people.find((p) => p.id === personId)?.staff; }

  async staffByEmail(email: string) {
    const p = this.people.find((x) => x.staff && x.email === email);
    return p ? { personId: p.id, whatsappE164: p.whatsappE164 } : null;
  }

  async accountLabel(accountId: string) { return this.accounts.get(accountId) ?? null; }

  async findOpenAlert(severity: AlertSeverity, title: string, accountId: string | null) {
    return this.alerts.find((a) => !a.resolvedAt && a.severity === severity && a.title === title && a.accountId === accountId)?.id ?? null;
  }

  async insertAlert(row: { severity: AlertSeverity; title: string; accountId: string | null; link: string | null; notifiedVia: string[]; openedAt: Date }) {
    const id = this.nextId("alert");
    this.alerts.push({ id, ...row, resolvedAt: null, resolvedBy: null });
    return id;
  }

  async getAlert(id: string) { return this.alerts.find((a) => a.id === id) ?? null; }

  async resolveAlert(id: string, personId: string, at: Date) {
    const a = this.alerts.find((x) => x.id === id);
    if (!a || a.resolvedAt) return false;
    a.resolvedAt = at;
    a.resolvedBy = personId;
    return true;
  }

  async audit(entries: AuditEntry[]) { this.audits.push(...entries); }
}
