// AuthGateway over Supabase Auth e-mail OTP (02 §5). Code length and expiry are set in supabase/config.toml.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthRateLimited, type AuthGateway } from "./login";

/** The session id travels in the access token's session_id claim. */
export function sessionIdOf(accessToken: string): string {
  const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
  if (typeof payload.session_id !== "string") throw new Error("access token without session_id");
  return payload.session_id;
}

/** Supabase Auth answers 429 (code over_email_send_rate_limit) inside its max_frequency window. */
function isRateLimit(error: { status?: number; code?: string }): boolean {
  return error.status === 429 || (typeof error.code === "string" && error.code.includes("rate_limit"));
}

export class SupabaseAuthGateway implements AuthGateway {
  /** `client` should be the cookie-backed client, so verifying also sets the session cookies. */
  constructor(private client: SupabaseClient) {}

  async sendCode(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error && isRateLimit(error)) throw new AuthRateLimited(error.message);
    if (error) throw new Error(`send code failed: ${error.message}`);
  }

  async verifyCode(email: string, code: string) {
    const { data, error } = await this.client.auth.verifyOtp({ email, token: code, type: "email" });
    if (error || !data.session || !data.user) return null;
    return { userId: data.user.id, sessionId: sessionIdOf(data.session.access_token) };
  }
}
