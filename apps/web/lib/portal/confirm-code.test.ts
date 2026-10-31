import { describe, expect, it } from "vitest";
import { MESSAGES, type AuthGateway } from "@/lib/auth/login";
import { emptyGuard, type Guard } from "@/lib/auth/rules";
import { checkConfirmCode, sendConfirmCode, type ConfirmDeps } from "./confirm-code";

function fakes(start = new Date("2026-11-20T13:00:00Z")) {
  let now = start;
  const guards = new Map<string, Guard>();
  const sent: string[] = [];
  const gateway: AuthGateway = {
    async sendCode(email) {
      sent.push(email);
    },
    async verifyCode(email, code) {
      return code === "123456" ? { userId: `auth:${email}`, sessionId: "s" } : null;
    },
  };
  const deps: ConfirmDeps = {
    guards: { getGuard: async (e) => guards.get(e) ?? emptyGuard(), saveGuard: async (e, g) => void guards.set(e, g) },
    gateway,
    now: () => now,
  };
  return { deps, sent, tick: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("W09 code confirmation (04 §8: contact change, account deletion)", () => {
  it("E04_code_goes_to_the_address_and_a_resend_waits_60_seconds", async () => {
    const f = fakes();
    expect(await sendConfirmCode(f.deps, " Novo@Exemplo.com.br ")).toEqual({ ok: true, message: MESSAGES.sent });
    expect(f.sent).toEqual(["novo@exemplo.com.br"]);
    expect(await sendConfirmCode(f.deps, "novo@exemplo.com.br")).toEqual({ ok: false, message: MESSAGES.tooSoon });
    f.tick(60_000);
    expect((await sendConfirmCode(f.deps, "novo@exemplo.com.br")).ok).toBe(true);
  });

  it("E04_right_code_answers_the_auth_user_wrong_code_counts_a_try", async () => {
    const f = fakes();
    await sendConfirmCode(f.deps, "novo@exemplo.com.br");
    expect(await checkConfirmCode(f.deps, "novo@exemplo.com.br", "000000")).toEqual({ ok: false, message: MESSAGES.wrong });
    expect(await checkConfirmCode(f.deps, "novo@exemplo.com.br", "123456")).toEqual({ ok: true, authUserId: "auth:novo@exemplo.com.br" });
  });

  it("E04_five_wrong_codes_lock_for_15_minutes", async () => {
    const f = fakes();
    await sendConfirmCode(f.deps, "novo@exemplo.com.br");
    for (let i = 0; i < 4; i++) await checkConfirmCode(f.deps, "novo@exemplo.com.br", "000000");
    expect(await checkConfirmCode(f.deps, "novo@exemplo.com.br", "000000")).toEqual({ ok: false, message: MESSAGES.locked });
    expect(await checkConfirmCode(f.deps, "novo@exemplo.com.br", "123456")).toEqual({ ok: false, message: MESSAGES.locked });
  });

  it("E04_no_code_sent_or_older_than_10_minutes_is_expired", async () => {
    const f = fakes();
    expect(await checkConfirmCode(f.deps, "novo@exemplo.com.br", "123456")).toEqual({ ok: false, message: MESSAGES.expired });
    await sendConfirmCode(f.deps, "novo@exemplo.com.br");
    f.tick(10 * 60_000);
    expect(await checkConfirmCode(f.deps, "novo@exemplo.com.br", "123456")).toEqual({ ok: false, message: MESSAGES.expired });
  });

  it("E04_a_malformed_code_never_reaches_auth", async () => {
    const f = fakes();
    await sendConfirmCode(f.deps, "novo@exemplo.com.br");
    expect(await checkConfirmCode(f.deps, "novo@exemplo.com.br", "12ab56")).toEqual({ ok: false, message: MESSAGES.wrong });
  });
});
