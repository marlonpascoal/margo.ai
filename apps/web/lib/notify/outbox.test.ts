// E05: queueing a notice for an account and delivering the outbox, with fakes and a fake clock.
import { beforeEach, describe, expect, it } from "vitest";
import { FakeNotifyStore } from "./fake-store";
import { notify, processOutbox, type NotifyDeps } from "./outbox";
import type { Notifier, OutgoingMessage } from "./providers";

class RecordingNotifier implements Notifier {
  delivered: OutgoingMessage[] = [];
  failFor = new Set<string>();
  async deliver(msg: OutgoingMessage) {
    if (this.failFor.has(msg.to)) throw new Error("provider down");
    this.delivered.push(msg);
    return { providerId: msg.channel === "email" ? `mail-${msg.notificationId}` : `https://wa.me/${msg.to.slice(1)}` };
  }
}

let store: FakeNotifyStore;
let notifier: RecordingNotifier;
let now: Date;
let deps: NotifyDeps & { notifier: Notifier };
const sp = (iso: string) => new Date(`${iso}-03:00`);
const msg = { subject: "Setembro fechado", body: "Seu fechamento de setembro está pronto", whatsapp: "Fechamento de setembro pronto." };

beforeEach(() => {
  store = new FakeNotifyStore();
  notifier = new RecordingNotifier();
  now = sp("2026-11-05T14:00:00");
  deps = { store, notifier, now: () => now };
  store.accounts.set("acc", "Grupo Exemplo");
  store.people.push(
    { id: "dono", name: "Dono", email: "dono@exemplo.com.br", whatsappE164: "+5543912341234", memberships: [{ accountId: "acc", role: "dono" }] },
    { id: "fin", name: "Financeiro", email: "fin@exemplo.com.br", whatsappE164: "+5543955554444", memberships: [{ accountId: "acc", role: "financeiro" }] },
    { id: "ger", name: "Gerente", email: "ger@exemplo.com.br", whatsappE164: null, memberships: [{ accountId: "acc", role: "gerente" }] },
    { id: "outro", name: "Outra conta", email: "outro@exemplo.com.br", whatsappE164: null, memberships: [{ accountId: "acc-2", role: "dono" }] },
  );
});

const rows = () => store.notifications.map((n) => `${n.personId}:${n.channel}:${n.status}`);

describe("E05 notify", () => {
  it("E05_notify_follows_audience_and_each_persons_preferences", async () => {
    store.prefRows.push({ id: "p1", personId: "fin", accountId: "acc", noticeCode: "close_ready", pref: { email: true, whatsapp: false } });
    expect(await notify(deps, { code: "close_ready", accountId: "acc", message: msg })).toEqual({ queued: 3, held: 0 });
    expect(rows()).toEqual(["dono:email:queued", "dono:whatsapp_manual:queued", "fin:email:queued"]);
  });

  it("E05_email_body_ends_with_the_drawn_footer", async () => {
    await notify(deps, { code: "close_ready", accountId: "acc", message: msg, personIds: ["dono"] });
    const mail = store.notifications.find((n) => n.channel === "email")!;
    expect(mail.body).toBe(
      "Seu fechamento de setembro está pronto\n\nVocê recebe este e-mail porque é Dono no Grupo Exemplo.\nMudar notificações: /app/notificacoes",
    );
    expect(store.notifications.find((n) => n.channel === "whatsapp_manual")!.body).toBe("Fechamento de setembro pronto.");
  });

  it("E05_locked_notice_goes_by_email_whatever_the_stored_pref", async () => {
    // A row the trigger would refuse, to prove the planner does not rely on it.
    store.prefRows.push({ id: "p1", personId: "dono", accountId: "acc", noticeCode: "billing_result", pref: { email: false, whatsapp: false } });
    await notify(deps, { code: "billing_result", accountId: "acc", message: msg });
    expect(rows()).toEqual(["dono:email:queued"]);
  });

  it("E05_quiet_hours_hold_whatsapp_until_8h", async () => {
    now = sp("2026-11-05T23:10:00");
    expect(await notify(deps, { code: "deadline_soon", accountId: "acc", message: msg, personIds: ["dono"] })).toEqual({ queued: 1, held: 1 });

    // At 03:00 the e-mail goes; WhatsApp stays held.
    now = sp("2026-11-06T03:00:00");
    expect(await processOutbox(deps)).toEqual({ sent: 1, released: 0, held: 1, failed: 0 });
    expect(rows()).toEqual(["dono:email:sent", "dono:whatsapp_manual:held_quiet_hours"]);

    // At 08:00 the held WhatsApp is released.
    now = sp("2026-11-06T08:00:00");
    expect(await processOutbox(deps)).toEqual({ sent: 1, released: 1, held: 0, failed: 0 });
    const wa = store.notifications.find((n) => n.channel === "whatsapp_manual")!;
    expect(wa).toMatchObject({ status: "sent", sentAt: now, providerId: "https://wa.me/5543912341234" });
  });

  it("E05_a_whatsapp_queued_by_day_and_processed_at_night_is_held", async () => {
    await notify(deps, { code: "data_stale", accountId: "acc", message: msg });
    now = sp("2026-11-05T22:30:00");
    expect(await processOutbox(deps)).toEqual({ sent: 1, released: 0, held: 1, failed: 0 });
    expect(rows()).toEqual(["dono:email:sent", "dono:whatsapp_manual:held_quiet_hours"]);
  });
});

describe("outbox delivery", () => {
  it("delivers a row queued without recipient (security_event from login) to the person's e-mail", async () => {
    store.notifications.push({
      id: "sec-1", accountId: "acc", personId: "dono", noticeCode: "security_event", alertId: null, channel: "email",
      subject: "Login em aparelho novo", body: "Dono entrou na MargoAI por um aparelho novo.", status: "queued", recipient: null,
      sentAt: null, providerId: null,
    });
    expect(await processOutbox(deps)).toEqual({ sent: 1, released: 0, held: 0, failed: 0 });
    expect(notifier.delivered[0]).toMatchObject({ to: "dono@exemplo.com.br", subject: "Login em aparelho novo" });
    expect(store.notifications[0]).toMatchObject({ status: "sent", providerId: "mail-sec-1" });
  });

  it("marks a row failed when the provider throws or there is no address, and leaves others going", async () => {
    notifier.failFor.add("dono@exemplo.com.br");
    store.notifications.push({
      id: "x", accountId: "acc", personId: "ger", noticeCode: "weekly_summary", alertId: null, channel: "whatsapp_manual",
      subject: null, body: "oi", status: "queued", recipient: null, sentAt: null, providerId: null,
    });
    await notify(deps, { code: "new_difference", accountId: "acc", message: msg });
    const errors: string[] = [];
    const orig = console.error;
    console.error = (s: string) => errors.push(s);
    try {
      expect(await processOutbox(deps)).toEqual({ sent: 1, released: 0, held: 0, failed: 2 });
    } finally {
      console.error = orig;
    }
    expect(rows()).toEqual(["ger:whatsapp_manual:failed", "dono:email:failed", "fin:email:sent"]);
    expect(errors[0]).not.toContain("dono@exemplo.com.br");
  });

  it("a row already moved by another run is not counted twice", async () => {
    await notify(deps, { code: "new_difference", accountId: "acc", message: msg, personIds: ["dono"] });
    const snapshot = await store.outbox(10);
    store.notifications[0].status = "sent";
    store.outbox = async () => snapshot;
    expect(await processOutbox(deps)).toEqual({ sent: 0, released: 0, held: 0, failed: 0 });
  });
});
