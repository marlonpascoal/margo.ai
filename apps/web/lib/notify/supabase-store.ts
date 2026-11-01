// NotifyStore over Postgres, with the service role (04 §9, §10). Covered by notify.int.test.ts.
import type { Json } from "@margoai/contracts";
import type { Db } from "@/lib/supabase/admin";
import type { ChannelPref, NoticeType, NotificationStatus, PlannedNotification, Role } from "./plan";
import type { AlertSeverity, AuditEntry, NotifyStore, OutboxRow } from "./store";

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** For queries that always return data (lists, single). */
function must<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  const data = check(res);
  if (data === null || data === undefined) throw new Error("query returned no data");
  return data;
}

export class SupabaseNotifyStore implements NotifyStore {
  constructor(private db: Db) {}

  async noticeType(code: string): Promise<NoticeType | null> {
    const t = check(
      await this.db.from("notice_type").select("code, name, audience_roles, email_locked, default_email, default_whatsapp").eq("code", code).maybeSingle(),
    );
    if (!t) return null;
    return {
      code: t.code,
      name: t.name,
      audienceRoles: t.audience_roles as Role[],
      emailLocked: t.email_locked,
      defaultEmail: t.default_email,
      defaultWhatsapp: t.default_whatsapp,
    };
  }

  async audience(accountId: string, roles: Role[]) {
    const account = must(await this.db.from("account").select("name").eq("id", accountId).single());
    const rows = must(
      await this.db
        .from("membership")
        .select("person_id, role, person(email, whatsapp_e164)")
        .eq("account_id", accountId)
        .in("role", roles)
        .order("created_at"),
    );
    return rows.map((m) => ({
      personId: m.person_id,
      accountId,
      accountName: account.name,
      role: m.role,
      email: m.person?.email ?? null,
      whatsappE164: m.person?.whatsapp_e164 ?? null,
    }));
  }

  async prefs(accountId: string, noticeCode: string, personIds: string[]) {
    if (personIds.length === 0) return new Map<string, ChannelPref>();
    const rows = must(
      await this.db.from("notice_pref").select("person_id, email, whatsapp").eq("account_id", accountId).eq("notice_code", noticeCode).in("person_id", personIds),
    );
    return new Map(rows.map((r) => [r.person_id, { email: r.email, whatsapp: r.whatsapp }]));
  }

  async insertNotifications(rows: PlannedNotification[]) {
    if (rows.length === 0) return [];
    const created = must(
      await this.db
        .from("notification")
        .insert(
          rows.map((r) => ({
            account_id: r.accountId,
            person_id: r.personId,
            notice_code: r.noticeCode,
            alert_id: r.alertId,
            channel: r.channel,
            subject: r.subject,
            body: r.body,
            status: r.status,
            recipient: r.recipient,
            html: r.html ?? null,
            attachment_path: r.attachmentPath ?? null,
          })),
        )
        .select("id"),
    );
    return created.map((c) => c.id);
  }

  async outbox(limit: number): Promise<OutboxRow[]> {
    const rows = must(
      await this.db
        .from("notification")
        .select("id, account_id, person_id, notice_code, alert_id, channel, subject, body, status, recipient, html, attachment_path, alert(severity)")
        .in("status", ["queued", "held_quiet_hours"])
        .order("created_at")
        .limit(limit),
    );
    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      personId: r.person_id,
      noticeCode: r.notice_code,
      alertId: r.alert_id,
      alertSeverity: r.alert?.severity ?? null,
      channel: r.channel,
      subject: r.subject,
      body: r.body,
      status: r.status,
      recipient: r.recipient,
      html: r.html,
      attachmentPath: r.attachment_path,
    }));
  }

  async contact(personId: string) {
    const p = check(await this.db.from("person").select("email, whatsapp_e164").eq("id", personId).maybeSingle());
    return p ? { email: p.email, whatsappE164: p.whatsapp_e164 } : null;
  }

  async setStatus(id: string, from: NotificationStatus, to: NotificationStatus, sent?: { at: Date; providerId: string }) {
    const patch = sent ? { status: to, sent_at: sent.at.toISOString(), provider_id: sent.providerId } : { status: to };
    const rows = must(await this.db.from("notification").update(patch).eq("id", id).eq("status", from).select("id"));
    return rows.length === 1;
  }

  async membershipRole(personId: string, accountId: string) {
    const m = check(await this.db.from("membership").select("role").eq("person_id", personId).eq("account_id", accountId).maybeSingle());
    return m?.role ?? null;
  }

  async savePref(personId: string, accountId: string, noticeCode: string, pref: ChannelPref) {
    const row = must(
      await this.db
        .from("notice_pref")
        .upsert(
          { person_id: personId, account_id: accountId, notice_code: noticeCode, email: pref.email, whatsapp: pref.whatsapp },
          { onConflict: "person_id,account_id,notice_code" },
        )
        .select("id")
        .single(),
    );
    return row.id;
  }

  async isStaff(personId: string) {
    return !!check(await this.db.from("staff").select("id").eq("person_id", personId).maybeSingle());
  }

  async staffByEmail(email: string) {
    const p = check(await this.db.from("person").select("id, whatsapp_e164").ilike("email", email).maybeSingle());
    if (!p || !(await this.isStaff(p.id))) return null;
    return { personId: p.id, whatsappE164: p.whatsapp_e164 };
  }

  async accountLabel(accountId: string) {
    const a = check(await this.db.from("account").select("name, code").eq("id", accountId).maybeSingle());
    return a ? `${a.name} (${a.code})` : null;
  }

  async findOpenAlert(severity: AlertSeverity, title: string, accountId: string | null) {
    let q = this.db.from("alert").select("id").eq("severity", severity).eq("title", title).is("resolved_at", null);
    q = accountId ? q.eq("account_id", accountId) : q.is("account_id", null);
    const rows = must(await q.order("opened_at").limit(1));
    return rows[0]?.id ?? null;
  }

  async insertAlert(row: { severity: AlertSeverity; title: string; accountId: string | null; link: string | null; notifiedVia: string[]; openedAt: Date }) {
    const created = must(
      await this.db
        .from("alert")
        .insert({
          severity: row.severity,
          title: row.title,
          account_id: row.accountId,
          link: row.link,
          notified_via: row.notifiedVia,
          opened_at: row.openedAt.toISOString(),
        })
        .select("id")
        .single(),
    );
    return created.id;
  }

  async getAlert(id: string) {
    const a = check(
      await this.db.from("alert").select("id, severity, title, account_id, link, notified_via, resolved_at, resolved_by").eq("id", id).maybeSingle(),
    );
    if (!a) return null;
    return {
      id: a.id,
      severity: a.severity,
      title: a.title,
      accountId: a.account_id,
      link: a.link,
      notifiedVia: a.notified_via,
      resolvedAt: a.resolved_at ? new Date(a.resolved_at) : null,
      resolvedBy: a.resolved_by,
    };
  }

  async resolveAlert(id: string, personId: string, at: Date) {
    const rows = must(
      await this.db.from("alert").update({ resolved_at: at.toISOString(), resolved_by: personId }).eq("id", id).is("resolved_at", null).select("id"),
    );
    return rows.length === 1;
  }

  async audit(entries: AuditEntry[]) {
    if (entries.length === 0) return;
    check(
      await this.db.from("audit_log").insert(
        entries.map((e) => ({
          actor_person_id: e.actorPersonId,
          actor_kind: e.actorKind,
          account_id: e.accountId,
          action: e.action,
          entity: e.entity,
          entity_id: e.entityId,
          before: (e.before ?? null) as Json,
          after: (e.after ?? null) as Json,
          ip: e.ip,
          user_agent: e.userAgent,
        })),
      ),
    );
  }
}
