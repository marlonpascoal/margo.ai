// E03: Supabase Auth refusals on send. Its own max_frequency (60 s) maps to our tooSoon answer, not a 500.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AuthRateLimited } from "./login";
import { SupabaseAuthGateway } from "./supabase-gateway";

const clientReturning = (error: unknown) =>
  ({ auth: { signInWithOtp: async () => ({ data: {}, error }) } }) as unknown as SupabaseClient;

describe("SupabaseAuthGateway.sendCode", () => {
  it("E03_supabase_rate_limit_becomes_AuthRateLimited", async () => {
    const byCode = new SupabaseAuthGateway(clientReturning({ status: 429, code: "over_email_send_rate_limit", message: "x" }));
    await expect(byCode.sendCode("a@b.c")).rejects.toBeInstanceOf(AuthRateLimited);
    const byStatus = new SupabaseAuthGateway(clientReturning({ status: 429, message: "For security purposes, you can only request this after 59 seconds." }));
    await expect(byStatus.sendCode("a@b.c")).rejects.toBeInstanceOf(AuthRateLimited);
  });

  it("E03_other_supabase_errors_still_throw", async () => {
    const gw = new SupabaseAuthGateway(clientReturning({ status: 500, code: "unexpected_failure", message: "db down" }));
    await expect(gw.sendCode("a@b.c")).rejects.toThrow("send code failed: db down");
  });

  it("E03_success_resolves", async () => {
    await expect(new SupabaseAuthGateway(clientReturning(null)).sendCode("a@b.c")).resolves.toBeUndefined();
  });
});
