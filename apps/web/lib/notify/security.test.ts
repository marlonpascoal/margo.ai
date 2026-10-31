// P15, E05: security_event from a new-device login goes through preference planning.
import { beforeEach, describe, expect, it } from "vitest";
import { FakeNotifyStore } from "./fake-store";
import { notifyNewDevice } from "./security";

let store: FakeNotifyStore;
const sp = (iso: string) => new Date(`${iso}-03:00`);
let now = sp("2026-11-05T14:00:00");
const deps = () => ({ store, now: () => now });

beforeEach(() => {
  store = new FakeNotifyStore();
  now = sp("2026-11-05T14:00:00");
  store.accounts.set("acc", "Grupo Exemplo");
  store.accounts.set("acc-2", "Outra conta");
  store.people.push(
    { id: "dono", name: "Dono", email: "dono@exemplo.com.br", whatsappE164: "+5543912341234", memberships: [{ accountId: "acc", role: "dono" }] },
    { id: "fin", name: "Financeiro", email: "fin@exemplo.com.br", whatsappE164: null, memberships: [{ accountId: "acc", role: "financeiro" }, { accountId: "acc-2", role: "financeiro" }] },
    { id: "dono2", name: "Dono 2", email: "dono2@exemplo.com.br", whatsappE164: "+5543900001111", memberships: [{ accountId: "acc-2", role: "dono" }] },
  );
});

const rows = () => store.notifications.map((n) => `${n.personId}:${n.channel}:${n.status}`);

describe("P15 security_event through the planner", () => {
  it("P15_E05_new_device_notifies_each_dono_by_email_with_default_prefs", async () => {
    expect(await notifyNewDevice(deps(), { personName: "Financeiro", accountIds: ["acc", "acc-2"], userAgent: "Firefox" })).toEqual({ queued: 2, held: 0 });
    expect(rows()).toEqual(["dono:email:queued", "dono2:email:queued"]);
    const n = store.notifications[0];
    expect(n).toMatchObject({ accountId: "acc", noticeCode: "security_event", recipient: "dono@exemplo.com.br", subject: "Login em aparelho novo" });
    expect(n.body).toContain("Financeiro entrou na MargoAI por um aparelho novo (Firefox).");
    expect(n.body).toContain("Você recebe este e-mail porque é Dono no Grupo Exemplo.");
  });

  it("P15_E05_dono_whatsapp_pref_adds_whatsapp_and_respects_quiet_hours", async () => {
    await store.savePref("dono", "acc", "security_event", { email: true, whatsapp: true });
    now = sp("2026-11-05T23:00:00");
    expect(await notifyNewDevice(deps(), { personName: "Financeiro", accountIds: ["acc"], userAgent: null })).toEqual({ queued: 1, held: 1 });
    expect(rows()).toEqual(["dono:email:queued", "dono:whatsapp_manual:held_quiet_hours"]);
  });

  it("P15_E05_email_still_goes_when_the_stored_pref_says_off_because_the_notice_is_locked", async () => {
    // A row that predates the lock, written around the trigger: the planner still sends the e-mail.
    store.prefRows.push({ id: "p1", personId: "dono", accountId: "acc", noticeCode: "security_event", pref: { email: false, whatsapp: false } });
    await notifyNewDevice(deps(), { personName: "Financeiro", accountIds: ["acc"], userAgent: null });
    expect(rows()).toEqual(["dono:email:queued"]);
  });

  it("P15_E05_no_accounts_no_rows", async () => {
    expect(await notifyNewDevice(deps(), { personName: "Staff", accountIds: [], userAgent: null })).toEqual({ queued: 0, held: 0 });
    expect(store.notifications).toEqual([]);
  });
});
