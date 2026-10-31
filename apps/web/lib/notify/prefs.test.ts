// E05 and P16/W08: preference updates, refused for locked e-mail, audited.
import { beforeEach, describe, expect, it } from "vitest";
import { FakeNotifyStore } from "./fake-store";
import type { NotifyDeps } from "./outbox";
import { PREF_MESSAGES, updateNoticePref } from "./prefs";

let store: FakeNotifyStore;
let deps: NotifyDeps;
const meta = { ip: "203.0.113.7", userAgent: "vitest" };

beforeEach(() => {
  store = new FakeNotifyStore();
  deps = { store, now: () => new Date("2026-11-05T17:00:00Z") };
  store.accounts.set("acc", "Grupo Exemplo");
  store.people.push({ id: "dono", name: "Dono", email: "d@x.com", whatsappE164: null, memberships: [{ accountId: "acc", role: "dono" }] });
});

describe("E05 preference updates", () => {
  it.each(["billing_result", "security_event", "trial_ending"])("E05_locked_email_cannot_be_turned_off_%s", async (code) => {
    const r = await updateNoticePref(deps, { personId: "dono", accountId: "acc", noticeCode: code, email: false, meta });
    expect(r).toEqual({ ok: false, message: PREF_MESSAGES.locked });
    expect(store.prefRows).toEqual([]);
    expect(store.audits).toEqual([]);
  });

  it("E05_whatsapp_of_a_locked_notice_can_change", async () => {
    const r = await updateNoticePref(deps, { personId: "dono", accountId: "acc", noticeCode: "billing_result", whatsapp: true, meta });
    expect(r).toEqual({ ok: true, pref: { email: true, whatsapp: true } });
  });

  it("E05_preference_saved_from_defaults_and_audited", async () => {
    const r = await updateNoticePref(deps, { personId: "dono", accountId: "acc", noticeCode: "close_ready", email: false, meta });
    expect(r).toEqual({ ok: true, pref: { email: false, whatsapp: true } });
    expect(store.prefRows).toMatchObject([{ personId: "dono", noticeCode: "close_ready", pref: { email: false, whatsapp: true } }]);
    expect(store.audits).toEqual([
      {
        actorPersonId: "dono", actorKind: "person", accountId: "acc", action: "notice_pref.update", entity: "notice_pref",
        entityId: store.prefRows[0].id,
        before: { notice_code: "close_ready", email: true, whatsapp: true },
        after: { notice_code: "close_ready", email: false, whatsapp: true },
        ip: "203.0.113.7", userAgent: "vitest",
      },
    ]);

    // A second change starts from the stored row, not the defaults.
    await updateNoticePref(deps, { personId: "dono", accountId: "acc", noticeCode: "close_ready", whatsapp: false, meta });
    expect(store.prefRows).toHaveLength(1);
    expect(store.prefRows[0].pref).toEqual({ email: false, whatsapp: false });
    expect(store.audits[1].before).toEqual({ notice_code: "close_ready", email: false, whatsapp: true });
  });

  it("refuses a person outside the account and an unknown notice", async () => {
    expect(await updateNoticePref(deps, { personId: "dono", accountId: "acc-2", noticeCode: "close_ready", email: true, meta }))
      .toEqual({ ok: false, message: PREF_MESSAGES.notMember });
    expect(await updateNoticePref(deps, { personId: "dono", accountId: "acc", noticeCode: "nao_existe", email: true, meta }))
      .toEqual({ ok: false, message: PREF_MESSAGES.unknown });
  });
});
