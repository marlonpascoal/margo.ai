// Queueing notices and delivering the outbox (04 §9, §10, D36, E05).
import { isQuietHours, planNotice, type NotificationStatus } from "./plan";
import type { Notifier } from "./providers";
import type { NotifyStore, OutboxRow } from "./store";
import { messageFor, type MessageSource, type NoticeCode } from "./templates";

export interface NotifyDeps {
  store: NotifyStore;
  now: () => Date;
}

export interface NoticeRequest {
  code: NoticeCode;
  accountId: string;
  message: MessageSource;
  /** Limit to these people (e.g. the Dono of one kitchen); default: the whole audience. */
  personIds?: string[];
}

/** E05: one notice to every person of the account in its audience, by each person's preferences. */
export async function notify(deps: NotifyDeps, req: NoticeRequest): Promise<{ queued: number; held: number }> {
  const { store } = deps;
  const notice = await store.noticeType(req.code);
  if (!notice) throw new Error(`unknown notice ${req.code}`);
  let audience = await store.audience(req.accountId, notice.audienceRoles);
  if (req.personIds) audience = audience.filter((r) => req.personIds!.includes(r.personId));
  if (audience.length === 0) return { queued: 0, held: 0 };
  const prefs = await store.prefs(req.accountId, notice.code, audience.map((r) => r.personId));
  const now = deps.now();
  const rows = audience.flatMap((to) => planNotice(notice, to, prefs.get(to.personId) ?? null, messageFor(req.message, to), now));
  if (rows.length > 0) await store.insertNotifications(rows);
  return {
    queued: rows.filter((r) => r.status === "queued").length,
    held: rows.filter((r) => r.status === "held_quiet_hours").length,
  };
}

export interface OutboxResult {
  sent: number;
  /** Held rows that went out now that quiet hours are over (part of `sent`). */
  released: number;
  held: number;
  failed: number;
}

/** Owner WhatsApp waits for 8h; team alerts to the founder on duty do not (04 §10). */
const waitsForMorning = (row: OutboxRow) => row.channel !== "email" && row.alertId === null;

async function destination(store: NotifyStore, row: OutboxRow): Promise<string | null> {
  if (row.recipient) return row.recipient;
  if (!row.personId) return null;
  const c = await store.contact(row.personId);
  return (row.channel === "email" ? c?.email : c?.whatsappE164) ?? null;
}

/**
 * Delivers queued rows and releases held ones once quiet hours end. Rows are marked only from the
 * status they were read with, so two overlapping runs do not mark a row twice; schedule one runner.
 */
export async function processOutbox(deps: NotifyDeps & { notifier: Notifier }, limit = 100): Promise<OutboxResult> {
  const { store, notifier } = deps;
  const result: OutboxResult = { sent: 0, released: 0, held: 0, failed: 0 };
  for (const row of await store.outbox(limit)) {
    const now = deps.now();
    if (waitsForMorning(row) && isQuietHours(now)) {
      if (row.status === "queued") await store.setStatus(row.id, "queued", "held_quiet_hours");
      result.held++;
      continue;
    }
    const from: NotificationStatus = row.status;
    const to = await destination(store, row);
    if (!to) {
      if (await store.setStatus(row.id, from, "failed")) result.failed++;
      continue;
    }
    try {
      const { providerId } = await notifier.deliver({ notificationId: row.id, channel: row.channel, to, subject: row.subject, body: row.body });
      if (await store.setStatus(row.id, from, "sent", { at: now, providerId })) {
        result.sent++;
        if (from === "held_quiet_hours") result.released++;
      }
    } catch (err) {
      // 02 §8: one JSON line per external call; the message body and address stay out of logs.
      console.error(JSON.stringify({ service: "notifier", channel: row.channel, notification: row.id, error: String(err) }));
      if (await store.setStatus(row.id, from, "failed")) result.failed++;
    }
  }
  return result;
}
