// W09 "Trocar" for the login e-mail (04 §8, D35, E04): after the code on the new address is right, the
// person's auth user takes the new e-mail, the old address gets a notice, and every account of the person
// gets the 24-hour security_lock on plan and people changes (public.security_lock_contact_change, which
// also writes audit_log per account). WhatsApp has no automatic sending yet (D40), so only e-mail changes.
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
  const upd = await db.auth.admin.updateUserById(own, { email: c.newEmail, email_confirm: true });
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
