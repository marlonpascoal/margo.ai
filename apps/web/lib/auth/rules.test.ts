// E03: login code rules (04 §8) and session lengths, with a fake clock.
import { describe, expect, it } from "vitest";
import {
  CODE_TTL_MS,
  LOCK_MS,
  MAX_ATTEMPTS,
  RESEND_MS,
  SESSION_TTL_MS,
  afterFailure,
  afterSend,
  canSend,
  canVerify,
  emptyGuard,
  sessionExpired,
} from "./rules";

const t0 = new Date("2026-10-30T11:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const MIN = 60_000;

describe("E03 code rules", () => {
  it("E03_constants_match_04_section_8", () => {
    expect(CODE_TTL_MS).toBe(10 * MIN);
    expect(MAX_ATTEMPTS).toBe(5);
    expect(LOCK_MS).toBe(15 * MIN);
    expect(RESEND_MS).toBe(60_000);
  });

  it("E03_first_code_can_be_sent", () => {
    expect(canSend(emptyGuard(), t0)).toEqual({ ok: true });
  });

  it("E03_resend_waits_60_seconds", () => {
    const g = afterSend(emptyGuard(), t0);
    expect(canSend(g, at(59_000))).toEqual({ ok: false, reason: "too_soon", retryAt: at(60_000) });
    expect(canSend(g, at(60_000))).toEqual({ ok: true });
  });

  it("E03_code_is_valid_for_10_minutes", () => {
    const g = afterSend(emptyGuard(), t0);
    expect(canVerify(g, at(10 * MIN - 1))).toEqual({ ok: true });
    expect(canVerify(g, at(10 * MIN))).toEqual({ ok: false, reason: "expired" });
  });

  it("E03_no_code_sent_cannot_be_verified", () => {
    expect(canVerify(emptyGuard(), t0)).toEqual({ ok: false, reason: "expired" });
  });

  it("E03_five_wrong_tries_lock_for_15_minutes", () => {
    let g = afterSend(emptyGuard(), t0);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      g = afterFailure(g, at(i * 1000));
      expect(canVerify(g, at(i * 1000))).toEqual({ ok: true });
    }
    g = afterFailure(g, at(5000));
    const until = at(5000 + 15 * MIN);
    expect(canVerify(g, at(6000))).toEqual({ ok: false, reason: "locked", retryAt: until });
    expect(canSend(g, at(6000))).toEqual({ ok: false, reason: "locked", retryAt: until });
  });

  it("E03_resending_does_not_reset_the_tries", () => {
    let g = afterSend(emptyGuard(), t0);
    g = afterFailure(afterFailure(afterFailure(afterFailure(g, t0), t0), t0), t0);
    g = afterSend(g, at(RESEND_MS));
    g = afterFailure(g, at(RESEND_MS + 1));
    expect(canVerify(g, at(RESEND_MS + 2))).toMatchObject({ ok: false, reason: "locked" });
  });

  it("E03_after_the_lock_a_new_code_starts_clean", () => {
    let g = afterSend(emptyGuard(), t0);
    for (let i = 0; i < MAX_ATTEMPTS; i++) g = afterFailure(g, t0);
    const later = at(15 * MIN);
    expect(canSend(g, later)).toEqual({ ok: true });
    g = afterSend(g, later);
    expect(g.attempts).toBe(0);
    expect(canVerify(g, later)).toEqual({ ok: true });
  });
});

describe("E03 session lengths", () => {
  it("E03_console_session_lasts_12_hours", () => {
    expect(SESSION_TTL_MS.console).toBe(12 * 60 * MIN);
    expect(sessionExpired(t0, "console", at(12 * 60 * MIN - 1))).toBe(false);
    expect(sessionExpired(t0, "console", at(12 * 60 * MIN))).toBe(true);
  });

  it("E03_portal_session_lasts_30_days", () => {
    expect(SESSION_TTL_MS.portal).toBe(30 * 24 * 60 * MIN);
    expect(sessionExpired(t0, "portal", at(30 * 24 * 60 * MIN - 1))).toBe(false);
    expect(sessionExpired(t0, "portal", at(30 * 24 * 60 * MIN))).toBe(true);
  });
});
