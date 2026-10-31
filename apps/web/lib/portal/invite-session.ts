// P18 "Aceitar e entrar" for an e-mail invite: the single-use link that reached the inbox proves the
// address, like a code would, so the session opens without a second code. Supabase Auth issues it from
// a one-time token hash (no e-mail is sent); the device, security_event and audit follow the normal login
// (startSession, 04 §8).
import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";
import { startSession, type LoginStore, type RequestContext } from "@/lib/auth/login";
import { sessionIdOf } from "@/lib/auth/supabase-gateway";
import type { Db } from "@/lib/supabase/admin";

export async function openInviteSession(
  admin: Db,
  session: SupabaseClient,
  store: LoginStore,
  email: string,
  ctx: RequestContext,
): Promise<string | null> {
  const person = await store.findPerson(email, "portal");
  if (!person) return null;
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(`invite session failed: ${error?.message ?? "no token"}`);
  // A person without an auth user yet gets a sign-up token; the link says which kind it is.
  const type = (link.properties.verification_type ?? "magiclink") as EmailOtpType;
  const { data, error: verr } = await session.auth.verifyOtp({ token_hash: link.properties.hashed_token, type });
  if (verr || !data.session || !data.user) throw new Error(`invite session failed: ${verr?.message ?? "no session"}`);
  if (person.authUserId !== null && person.authUserId !== data.user.id) return null;
  return startSession(store, person, data.user.id, { surface: "portal", authSessionId: sessionIdOf(data.session.access_token), ctx });
}
