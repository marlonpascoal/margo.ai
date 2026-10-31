// E03: a session is valid only on its own surface, before its length runs out, and until revoked.
import { describe, expect, it } from "vitest";
import { checkSession } from "./session";

const t0 = new Date("2026-10-30T11:00:00Z");
const row = (over: Partial<Parameters<typeof checkSession>[0]> = {}) => ({
  surface: "console" as const,
  created_at: t0.toISOString(),
  revoked_at: null,
  ...over,
});
const hours = (h: number) => new Date(t0.getTime() + h * 3_600_000);

describe("E03 session check", () => {
  it("E03_console_session_valid_for_12_hours", () => {
    expect(checkSession(row(), "console", hours(11.9))).toBe("ok");
    expect(checkSession(row(), "console", hours(12))).toBe("expired");
  });

  it("E03_portal_session_valid_for_30_days", () => {
    expect(checkSession(row({ surface: "portal" }), "portal", hours(24 * 30 - 1))).toBe("ok");
    expect(checkSession(row({ surface: "portal" }), "portal", hours(24 * 30))).toBe("expired");
  });

  it("E03_portal_session_does_not_open_the_console", () => {
    expect(checkSession(row({ surface: "portal" }), "console", hours(1))).toBe("wrong_surface");
  });

  it("E03_revoked_session_is_refused", () => {
    expect(checkSession(row({ revoked_at: hours(1).toISOString() }), "console", hours(2))).toBe("revoked");
  });

  it("E03_missing_device_row_is_refused", () => {
    expect(checkSession(null, "portal", hours(1))).toBe("unknown");
  });
});
