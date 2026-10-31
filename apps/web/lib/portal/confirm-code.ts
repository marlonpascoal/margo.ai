// W09 code confirmation (04 §8, D35): the 6-digit e-mail code of the login, with the same rules (10
// minutes, 5 tries, 15-minute lock, resend after 60 s, auth_code_guard), used to prove an address without
// starting a portal session. W09 uses it for "Trocar" (code on the new e-mail) and for "Excluir a conta e
// os dados" (code on the Dono's own e-mail).
import { createClient } from "@supabase/supabase-js";
import { AuthRateLimited, MESSAGES, normalizeEmail, type AuthGateway, type LoginStore, type SendResult } from "@/lib/auth/login";
import { afterFailure, afterSend, afterSuccess, canSend, canVerify } from "@/lib/auth/rules";
import { publicEnv } from "@/lib/env";

export interface ConfirmDeps {
  guards: Pick<LoginStore, "getGuard" | "saveGuard">;
  gateway: AuthGateway;
  now: () => Date;
}

export type ConfirmResult = { ok: true; authUserId: string } | { ok: false; message: string };

const refusal = (reason: "locked" | "too_soon" | "expired") => (reason === "locked" ? MESSAGES.locked : reason === "too_soon" ? MESSAGES.tooSoon : MESSAGES.expired);

export async function sendConfirmCode(deps: ConfirmDeps, rawEmail: string): Promise<SendResult> {
  const email = normalizeEmail(rawEmail);
  const now = deps.now();
  const guard = await deps.guards.getGuard(email);
  const decision = canSend(guard, now);
  if (!decision.ok) return { ok: false, message: refusal(decision.reason) };
  await deps.guards.saveGuard(email, afterSend(guard, now));
  try {
    await deps.gateway.sendCode(email);
  } catch (e) {
    if (e instanceof AuthRateLimited) return { ok: false, message: MESSAGES.tooSoon };
    throw e;
  }
  return { ok: true, message: MESSAGES.sent };
}

/** The auth user that owns the address, once the code is right. */
export async function checkConfirmCode(deps: ConfirmDeps, rawEmail: string, code: string): Promise<ConfirmResult> {
  const email = normalizeEmail(rawEmail);
  const now = deps.now();
  const guard = await deps.guards.getGuard(email);
  const decision = canVerify(guard, now);
  if (!decision.ok) return { ok: false, message: refusal(decision.reason) };
  const auth = /^\d{6}$/.test(code) ? await deps.gateway.verifyCode(email, code) : null;
  if (!auth) {
    const next = afterFailure(guard, now);
    await deps.guards.saveGuard(email, next);
    return { ok: false, message: next.lockedUntil ? MESSAGES.locked : MESSAGES.wrong };
  }
  await deps.guards.saveGuard(email, afterSuccess(guard));
  return { ok: true, authUserId: auth.userId };
}

/**
 * Supabase Auth e-mail OTP on a client that keeps no cookies: proving the code does not replace the
 * person's portal session, and the session Auth opens for the check is signed out right away.
 */
export class EphemeralAuthGateway implements AuthGateway {
  private client() {
    const { supabaseUrl, supabaseAnonKey } = publicEnv();
    return createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }

  async sendCode(email: string): Promise<void> {
    const { error } = await this.client().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error && (error.status === 429 || String(error.code ?? "").includes("rate_limit"))) throw new AuthRateLimited(error.message);
    if (error) throw new Error(`send code failed: ${error.message}`);
  }

  async verifyCode(email: string, code: string) {
    const c = this.client();
    const { data, error } = await c.auth.verifyOtp({ email, token: code, type: "email" });
    if (error || !data.session || !data.user) return null;
    await c.auth.signOut({ scope: "local" });
    return { userId: data.user.id, sessionId: "" };
  }
}
