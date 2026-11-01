// W09 "Trocar" for the login e-mail (04 §8, D35, E04): after the code on the new address is right, the
// person's auth user takes the new e-mail, the old address gets a notice, and every account of the person
// gets the 24-hour security_lock on plan and people changes (public.security_lock_contact_change, which
// also writes audit_log per account). WhatsApp has no automatic sending yet (D40), so only e-mail changes.
// Every profile changes its own login e-mail (Marlon, 31/out).
//
// Sending the code creates an Auth user for the new address. It is kept as the pending change on the
// person's own Auth user (app_metadata), so an abandoned change does not leave it behind: it is removed
// when the person starts a change to another address, or once the code's 10 minutes are over (checked
// when the person next opens W09 or starts a change).
import type { Db } from "@/lib/supabase/admin";
import { normalizeEmail } from "./scope";

export const CONTACT_MESSAGES = {
  // Not drawn; same style as P15.
  invalid: "Escreva um e-mail válido.",
  same: "Esse já é o seu e-mail de login.",
  taken: "Esse e-mail já é usado por outra pessoa na MargoAI.",
  done: "E-mail trocado. Avisamos o endereço antigo. Mudanças em plano e pessoas ficam bloqueadas por 24 horas.",
} as const;

/** The new address may be used: valid, not the current one, not another person's. */
export async function checkNewEmail(db: Db, personId: string, current: string | null, raw: string): Promise<{ ok: true; email: string } | { ok: false; message: string }> {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, message: CONTACT_MESSAGES.invalid };
  if (current && email === current.toLowerCase()) return { ok: false, message: CONTACT_MESSAGES.same };
  const { data, error } = await db.from("person").select("id").ilike("email", email).neq("id", personId).limit(1);
  if (error) throw new Error(error.message);
  if (data.length > 0) return { ok: false, message: CONTACT_MESSAGES.taken };
  return { ok: true, email };
}

/** 04 §8: the code is valid 10 minutes; after that an unfinished change is abandoned. */
export const PENDING_CHANGE_MS = 10 * 60_000;
const PENDING_KEY = "pending_email_change";

export interface PendingEmailChange {
  email: string;
  authUserId: string;
  since: string;
}

/** The change a person started and did not finish, from their own Auth user. */
export async function pendingEmailChange(db: Db, ownAuthUserId: string): Promise<PendingEmailChange | null> {
  const { data, error } = await db.auth.admin.getUserById(ownAuthUserId);
  if (error) throw new Error(error.message);
  const p = (data.user?.app_metadata as Record<string, unknown> | undefined)?.[PENDING_KEY] as PendingEmailChange | null | undefined;
  return p?.email && p.authUserId ? p : null;
}

async function setPending(db: Db, ownAuthUserId: string, pending: PendingEmailChange | null) {
  // Auth merges app_metadata by key; null removes the key.
  const { error } = await db.auth.admin.updateUserById(ownAuthUserId, { app_metadata: { [PENDING_KEY]: pending } });
  if (error) throw new Error(error.message);
}

async function ownAuthUser(db: Db, personId: string): Promise<string> {
  const { data, error } = await db.from("person").select("auth_user_id").eq("id", personId).single();
  if (error) throw new Error(error.message);
  if (!data.auth_user_id) throw new Error("portal person without auth user");
  return data.auth_user_id;
}

/** Removes the pending change's Auth user when nobody uses it, and audits it (A04). */
async function discard(db: Db, ownId: string, pending: PendingEmailChange, who: { personId: string; accountId: string }, why: "replaced" | "expired") {
  if (pending.authUserId !== ownId) {
    const { data: user } = await db.from("person").select("id").eq("auth_user_id", pending.authUserId).maybeSingle();
    if (!user) {
      const del = await db.auth.admin.deleteUser(pending.authUserId);
      if (del.error && del.error.status !== 404) throw new Error(del.error.message);
    }
  }
  await setPending(db, ownId, null);
  const audit = await db.from("audit_log").insert({
    actor_person_id: who.personId,
    actor_kind: "person",
    account_id: who.accountId,
    action: "person.email_change_discarded",
    entity: "person",
    entity_id: who.personId,
    before: { pending_email: pending.email },
    after: { reason: why },
  });
  if (audit.error) throw new Error(audit.error.message);
}

/**
 * "Trocar" step 1, before the code is sent: an earlier change to another address is dropped, and the Auth
 * user for the new address is created here so its id is known and can be removed if the change is abandoned.
 * When the address already has an Auth user that is not this change's, it is left alone (not ours).
 */
export async function startEmailChange(db: Db, c: { personId: string; accountId: string; newEmail: string; now: Date }): Promise<void> {
  const ownId = await ownAuthUser(db, c.personId);
  const pending = await pendingEmailChange(db, ownId);
  if (pending && pending.email !== c.newEmail) await discard(db, ownId, pending, c, "replaced");
  if (pending && pending.email === c.newEmail) {
    await setPending(db, ownId, { ...pending, since: c.now.toISOString() });
    return;
  }
  const created = await db.auth.admin.createUser({ email: c.newEmail, email_confirm: true });
  if (created.data.user) await setPending(db, ownId, { email: c.newEmail, authUserId: created.data.user.id, since: c.now.toISOString() });
}

/** Drops a change whose code ran out (10 minutes after the last send). True when one was dropped. */
export async function discardExpiredEmailChange(db: Db, c: { personId: string; accountId: string; now: Date }): Promise<boolean> {
  const ownId = await ownAuthUser(db, c.personId);
  const pending = await pendingEmailChange(db, ownId);
  if (!pending || c.now.getTime() - new Date(pending.since).getTime() <= PENDING_CHANGE_MS) return false;
  await discard(db, ownId, pending, c, "expired");
  return true;
}

export interface EmailChange {
  personId: string;
  personName: string;
  accountId: string;
  oldEmail: string | null;
  newEmail: string;
  /** Auth user that proved the new address with the code (a fresh one, unless it was already this person's). */
  provedBy: string;
  meta: { ip: string | null; userAgent: string | null };
}

export async function changeLoginEmail(db: Db, c: EmailChange): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: person, error } = await db.from("person").select("auth_user_id").eq("id", c.personId).single();
  if (error) throw new Error(error.message);
  const own = person.auth_user_id;
  if (!own) throw new Error("portal person without auth user");
  if (c.provedBy !== own) {
    // The code opened a new auth user for the new address; it must belong to nobody, then it goes away
    // so the person's own auth user (and its open sessions) can take the address.
    const { data: other } = await db.from("person").select("id").eq("auth_user_id", c.provedBy).maybeSingle();
    if (other) return { ok: false, message: CONTACT_MESSAGES.taken };
    const del = await db.auth.admin.deleteUser(c.provedBy);
    if (del.error) throw new Error(del.error.message);
  }
  const upd = await db.auth.admin.updateUserById(own, { email: c.newEmail, email_confirm: true, app_metadata: { [PENDING_KEY]: null } });
  if (upd.error) throw new Error(upd.error.message);
  const p = await db.from("person").update({ email: c.newEmail }).eq("id", c.personId);
  if (p.error) throw new Error(p.error.message);

  const lock = await db.rpc("security_lock_contact_change", { p_person: c.personId, p_channel: "email", p_ip: c.meta.ip ?? undefined, p_user_agent: c.meta.userAgent ?? undefined });
  if (lock.error) throw new Error(lock.error.message);
  const audit = await db.from("audit_log").insert({
    actor_person_id: c.personId,
    actor_kind: "person",
    account_id: c.accountId,
    action: "person.email_change",
    entity: "person",
    entity_id: c.personId,
    before: { email: c.oldEmail },
    after: { email: c.newEmail },
    ip: c.meta.ip,
    user_agent: c.meta.userAgent,
  });
  if (audit.error) throw new Error(audit.error.message);

  // 04 §8: notice on the old channel. security_event is locked on for e-mail, so it always goes.
  if (c.oldEmail) {
    const n = await db.from("notification").insert({
      account_id: c.accountId,
      person_id: c.personId,
      notice_code: "security_event",
      channel: "email",
      recipient: c.oldEmail,
      subject: "Seu e-mail de login mudou",
      body: `O e-mail de login de ${c.personName} na MargoAI mudou para ${c.newEmail}. Se não foi você, avise a MargoAI agora.`,
    });
    if (n.error) throw new Error(n.error.message);
  }
  return { ok: true };
}
