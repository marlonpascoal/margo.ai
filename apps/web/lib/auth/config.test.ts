// E03: the Supabase Auth side of 04 §8 lives in supabase/config.toml.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const toml = readFileSync(new URL("../../../../supabase/config.toml", import.meta.url), "utf8");
const section = (name: string) => toml.split(`\n[${name}]\n`)[1]?.split("\n[")[0] ?? "";

describe("E03 Supabase Auth settings", () => {
  it("E03_email_code_has_6_digits_valid_10_minutes_resend_60_seconds", () => {
    const email = section("auth.email");
    expect(email).toMatch(/^otp_length = 6$/m);
    expect(email).toMatch(/^otp_expiry = 600$/m);
    expect(email).toMatch(/^max_frequency = "60s"$/m);
  });

  it("E03_auth_sessions_end_after_30_days_at_most", () => {
    expect(section("auth.sessions")).toMatch(/^timebox = "720h"$/m);
  });

  it("E03_code_email_is_in_portuguese", () => {
    expect(section("auth.email.template.magic_link")).toContain('subject = "Seu código de acesso à MargoAI"');
  });
});
