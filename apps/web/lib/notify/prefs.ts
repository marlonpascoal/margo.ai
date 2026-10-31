// P16, W08: each person picks, per notice and per channel, what they receive (04 §9, D36, E05).
// The database trigger app.notice_pref_locked refuses e-mail off for a locked notice too.
import { effectivePref, type ChannelPref } from "./plan";
import type { NotifyDeps } from "./outbox";
import type { RequestMeta } from "./store";

export const PREF_MESSAGES = {
  // W08 copy.
  locked: "Avisos de cobrança e de segurança sempre vão por e-mail, por exigência de registro.",
  // Not drawn; same style as W08.
  notMember: "Você não faz parte desta conta.",
  unknown: "Este aviso não existe.",
} as const;

export interface PrefUpdate {
  /** The person changing their own preferences ("Estas são as suas", W08). */
  personId: string;
  accountId: string;
  noticeCode: string;
  email?: boolean;
  whatsapp?: boolean;
  meta: RequestMeta;
}

export type PrefResult = { ok: true; pref: ChannelPref } | { ok: false; message: string };

/** E05: saves one person's choice for one notice; refuses e-mail off for a locked notice. Writes audit_log. */
export async function updateNoticePref(deps: NotifyDeps, u: PrefUpdate): Promise<PrefResult> {
  const { store } = deps;
  const notice = await store.noticeType(u.noticeCode);
  if (!notice) return { ok: false, message: PREF_MESSAGES.unknown };
  if (!(await store.membershipRole(u.personId, u.accountId))) return { ok: false, message: PREF_MESSAGES.notMember };
  if (notice.emailLocked && u.email === false) return { ok: false, message: PREF_MESSAGES.locked };

  const stored = (await store.prefs(u.accountId, notice.code, [u.personId])).get(u.personId) ?? null;
  const before = effectivePref(notice, stored);
  const after: ChannelPref = { email: u.email ?? before.email, whatsapp: u.whatsapp ?? before.whatsapp };
  const id = await store.savePref(u.personId, u.accountId, notice.code, after);
  await store.audit([
    {
      actorPersonId: u.personId,
      actorKind: "person",
      accountId: u.accountId,
      action: "notice_pref.update",
      entity: "notice_pref",
      entityId: id,
      before: { notice_code: notice.code, ...before },
      after: { notice_code: notice.code, ...after },
      ip: u.meta.ip,
      userAgent: u.meta.userAgent,
    },
  ]);
  return { ok: true, pref: after };
}
