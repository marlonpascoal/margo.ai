// E03 and C00: login flow against in-memory fakes (the Supabase-backed store has its own integration test).
import { beforeEach, describe, expect, it } from "vitest";
import { AuthRateLimited, MESSAGES, sendCode, verifyCode, type AuthGateway, type LoginDeps, type LoginPerson, type LoginStore } from "./login";
import { emptyGuard, type Guard } from "./rules";

const MIN = 60_000;

class FakeStore implements LoginStore {
  guards = new Map<string, Guard>();
  people: (LoginPerson & { email: string; staff: boolean; memberships: { accountId: string; role: string }[] })[] = [];
  sessions: { personId: string; surface: string; authSessionId: string; deviceKeyHash: string }[] = [];
  notices: { personId: string; accountIds: string[] }[] = [];
  audits: { action: string; personId: string; accountId: string | null }[] = [];

  async getGuard(email: string) { return this.guards.get(email) ?? emptyGuard(); }
  async saveGuard(email: string, g: Guard) { this.guards.set(email, g); }
  async findPerson(email: string, surface: "console" | "portal") {
    const p = this.people.find((x) => x.email === email);
    if (!p) return null;
    if (surface === "console" && !p.staff) return null;
    if (surface === "portal" && p.memberships.length === 0) return null;
    return p;
  }
  async linkAuthUser(personId: string, authUserId: string) {
    this.people.find((p) => p.id === personId)!.authUserId = authUserId;
  }
  async deviceHistory(personId: string, deviceKeyHash: string) {
    const mine = this.sessions.filter((s) => s.personId === personId);
    return { anyDevice: mine.length > 0, thisDevice: mine.some((s) => s.deviceKeyHash === deviceKeyHash) };
  }
  async createSession(row: { personId: string; surface: "console" | "portal"; authSessionId: string; deviceKeyHash: string }) {
    this.sessions.push(row);
    return `sd-${this.sessions.length}`;
  }
  async notifyNewDevice(personId: string, accountIds: string[]) { this.notices.push({ personId, accountIds }); }
  async audit(rows: { action: string; personId: string; accountId: string | null }[]) { this.audits.push(...rows); }
}

class FakeGateway implements AuthGateway {
  sent: string[] = [];
  codes = new Map<string, string>();
  verifyCalls = 0;
  async sendCode(email: string) { this.sent.push(email); this.codes.set(email, "123456"); }
  async verifyCode(email: string, code: string) {
    this.verifyCalls++;
    return this.codes.get(email) === code ? { userId: `auth-${email}`, sessionId: `sess-${this.verifyCalls}` } : null;
  }
}

let store: FakeStore;
let gateway: FakeGateway;
let now: Date;
let deps: LoginDeps;
const ctx = (deviceKey = "device-a") => ({ userAgent: "test", ipCity: "Londrina", deviceKey });

beforeEach(() => {
  store = new FakeStore();
  gateway = new FakeGateway();
  now = new Date("2026-10-30T11:00:00Z");
  deps = { store, gateway, now: () => now };
  store.people.push(
    { id: "marlon", authUserId: null, email: "marlon@margoai.com", staff: true, memberships: [], accountIds: [], donoAccountIds: [] },
    { id: "dono", authUserId: null, email: "dono@exemplo.com.br", staff: false,
      memberships: [{ accountId: "G-02", role: "dono" }], accountIds: ["G-02"], donoAccountIds: ["G-02"] },
    { id: "fin", authUserId: null, email: "financeiro@exemplo.com.br", staff: false,
      memberships: [{ accountId: "G-02", role: "financeiro" }], accountIds: ["G-02"], donoAccountIds: [] },
  );
});

const advance = (ms: number) => { now = new Date(now.getTime() + ms); };

describe("C00 and E03 sending codes", () => {
  it("C00_non_invited_email_gets_the_same_message_and_no_code", async () => {
    const invited = await sendCode(deps, { email: "marlon@margoai.com", surface: "console" });
    const stranger = await sendCode(deps, { email: "alguem@fora.com", surface: "console" });
    expect(stranger).toEqual(invited);
    expect(invited.message).toBe(MESSAGES.sent);
    expect(gateway.sent).toEqual(["marlon@margoai.com"]);
  });

  it("C00_restaurant_person_cannot_get_a_console_code", async () => {
    await sendCode(deps, { email: "dono@exemplo.com.br", surface: "console" });
    expect(gateway.sent).toEqual([]);
  });

  it("E03_portal_code_only_for_people_with_a_membership", async () => {
    await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" });
    await sendCode(deps, { email: "marlon@margoai.com", surface: "portal" });
    expect(gateway.sent).toEqual(["dono@exemplo.com.br"]);
  });

  it("E03_email_is_matched_case_insensitively", async () => {
    await sendCode(deps, { email: "  Dono@Exemplo.com.BR ", surface: "portal" });
    expect(gateway.sent).toEqual(["dono@exemplo.com.br"]);
  });

  it("E03_resend_within_60_seconds_is_refused_for_known_and_unknown_alike", async () => {
    await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" });
    await sendCode(deps, { email: "x@fora.com", surface: "portal" });
    advance(30_000);
    const a = await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" });
    const b = await sendCode(deps, { email: "x@fora.com", surface: "portal" });
    expect(a).toEqual({ ok: false, message: MESSAGES.tooSoon });
    expect(b).toEqual(a);
    expect(gateway.sent).toHaveLength(1);
  });
});

describe("E03 resend after a login", () => {
  it("E03_second_code_within_60_seconds_after_a_login_is_too_soon_not_an_error", async () => {
    await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" });
    await verifyCode(deps, { email: "dono@exemplo.com.br", code: "123456", surface: "portal", ctx: ctx() });
    advance(20_000);
    expect(await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" })).toEqual({ ok: false, message: MESSAGES.tooSoon });
    expect(gateway.sent).toHaveLength(1);
    advance(40_000);
    expect(await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" })).toEqual({ ok: true, message: MESSAGES.sent });
  });

  it("E03_login_clears_the_tries_but_keeps_the_send_time", async () => {
    await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" });
    await verifyCode(deps, { email: "dono@exemplo.com.br", code: "000000", surface: "portal", ctx: ctx() });
    await verifyCode(deps, { email: "dono@exemplo.com.br", code: "123456", surface: "portal", ctx: ctx() });
    expect(store.guards.get("dono@exemplo.com.br")).toEqual({ sentAt: now, attempts: 0, lockedUntil: null });
  });

  it("E03_auth_rate_limit_on_send_answers_too_soon", async () => {
    gateway.sendCode = async () => { throw new AuthRateLimited(); };
    expect(await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" })).toEqual({ ok: false, message: MESSAGES.tooSoon });
  });

  it("E03_other_auth_errors_on_send_still_throw", async () => {
    gateway.sendCode = async () => { throw new Error("boom"); };
    await expect(sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" })).rejects.toThrow("boom");
  });
});

describe("E03 verifying codes", () => {
  it("E03_valid_code_opens_a_session_links_the_person_and_audits", async () => {
    await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" });
    const r = await verifyCode(deps, { email: "dono@exemplo.com.br", code: "123456", surface: "portal", ctx: ctx() });
    expect(r).toMatchObject({ ok: true, personId: "dono" });
    expect(store.people.find((p) => p.id === "dono")!.authUserId).toBe("auth-dono@exemplo.com.br");
    expect(store.sessions).toEqual([
      expect.objectContaining({ personId: "dono", surface: "portal", authSessionId: "sess-1" }),
    ]);
    expect(store.audits).toEqual([{ action: "login", personId: "dono", accountId: "G-02", actorKind: "person" }]);
  });

  it("E03_code_older_than_10_minutes_is_refused_without_asking_auth", async () => {
    await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" });
    advance(10 * MIN);
    const r = await verifyCode(deps, { email: "dono@exemplo.com.br", code: "123456", surface: "portal", ctx: ctx() });
    expect(r).toEqual({ ok: false, message: MESSAGES.expired });
    expect(gateway.verifyCalls).toBe(0);
  });

  it("E03_fifth_wrong_try_locks_and_the_right_code_is_refused_during_the_lock", async () => {
    await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" });
    for (let i = 0; i < 4; i++) {
      const r = await verifyCode(deps, { email: "dono@exemplo.com.br", code: "000000", surface: "portal", ctx: ctx() });
      expect(r).toEqual({ ok: false, message: MESSAGES.wrong });
    }
    const fifth = await verifyCode(deps, { email: "dono@exemplo.com.br", code: "000000", surface: "portal", ctx: ctx() });
    expect(fifth).toEqual({ ok: false, message: MESSAGES.locked });
    const right = await verifyCode(deps, { email: "dono@exemplo.com.br", code: "123456", surface: "portal", ctx: ctx() });
    expect(right).toEqual({ ok: false, message: MESSAGES.locked });
    expect(gateway.verifyCalls).toBe(5);
    expect(await sendCode(deps, { email: "dono@exemplo.com.br", surface: "portal" })).toEqual({ ok: false, message: MESSAGES.locked });
  });

  it("E03_unknown_email_never_reaches_auth_and_still_counts_tries", async () => {
    await sendCode(deps, { email: "x@fora.com", surface: "portal" });
    for (let i = 0; i < 4; i++) await verifyCode(deps, { email: "x@fora.com", code: "123456", surface: "portal", ctx: ctx() });
    const r = await verifyCode(deps, { email: "x@fora.com", code: "123456", surface: "portal", ctx: ctx() });
    expect(r).toEqual({ ok: false, message: MESSAGES.locked });
    expect(gateway.verifyCalls).toBe(0);
  });

  it("E03_console_login_opens_a_console_session_audited_as_staff", async () => {
    await sendCode(deps, { email: "marlon@margoai.com", surface: "console" });
    await verifyCode(deps, { email: "marlon@margoai.com", code: "123456", surface: "console", ctx: ctx() });
    expect(store.sessions[0]).toMatchObject({ personId: "marlon", surface: "console" });
    expect(store.audits).toEqual([{ action: "login", personId: "marlon", accountId: null, actorKind: "staff" }]);
  });
});

describe("P15 new device raises security_event", () => {
  async function login(email: string, device: string) {
    advance(RESEND);
    await sendCode(deps, { email, surface: "portal" });
    return verifyCode(deps, { email, code: "123456", surface: "portal", ctx: ctx(device) });
  }
  const RESEND = 61_000;

  it("P15_first_login_ever_is_not_a_new_device_notice", async () => {
    await login("dono@exemplo.com.br", "device-a");
    expect(store.notices).toEqual([]);
  });

  it("P15_login_on_another_device_notifies_the_donos", async () => {
    await login("fin@x", "device-a"); // unknown, ignored
    await login("financeiro@exemplo.com.br", "device-a");
    await login("financeiro@exemplo.com.br", "device-a");
    expect(store.notices).toEqual([]);
    await login("financeiro@exemplo.com.br", "device-b");
    expect(store.notices).toEqual([{ personId: "fin", accountIds: ["G-02"] }]);
  });

  it("P15_device_key_is_stored_hashed", async () => {
    await login("dono@exemplo.com.br", "device-a");
    expect(store.sessions[0].deviceKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(store.sessions[0].deviceKeyHash).not.toContain("device-a");
  });
});
