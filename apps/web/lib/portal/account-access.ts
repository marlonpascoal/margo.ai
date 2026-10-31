// Owner portal access for the account screens (P13/W02, P12/W03, P14/W04, P03/W07): a valid portal
// session (04 §8) of a person with a membership. Every page, route and server action calls requirePortal()
// itself, server-side (02 §5); hiding a menu item is not security. To be reconciled with the portal
// shell's guard at merge (wave 2): same rules, one helper.
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Json } from "@margoai/contracts";
import { currentSession } from "@/lib/auth/session";
import { requestMeta } from "@/lib/console/request";
import { isEnabled, type FlagKey } from "@/lib/flags";
import { canPortal, type MemberRole, type PortalAction } from "@/lib/permissions";
import { adminClient, type Db } from "@/lib/supabase/admin";
import type { Scope } from "./scope";

/** Which account a person with several memberships is looking at (P15 "choose which to open"). */
export const ACCOUNT_COOKIE = "margo_conta";

export interface PortalMember extends Scope {
  personId: string;
  personName: string;
  membershipId: string;
  account: { id: string; code: string; name: string; isSynthetic: boolean };
}

/** The signed-in person and the account they opened, or null. Cached per request. */
export const portalMember = cache(async (): Promise<PortalMember | null> => {
  const session = await currentSession("portal");
  if (!session) return null;
  const db = adminClient();
  const { data, error } = await db
    .from("membership")
    .select("id, role, all_kitchens, created_at, person(name), account(id, code, name, is_synthetic), membership_kitchen(kitchen_id)")
    .eq("person_id", session.personId)
    .order("created_at");
  if (error) throw new Error(error.message);
  if (!data?.length) return null;
  const wanted = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  const m = data.find((x) => x.account?.code === wanted) ?? data[0];
  if (!m.account) return null;
  return {
    personId: session.personId,
    personName: m.person?.name ?? "",
    membershipId: m.id,
    role: m.role,
    allKitchens: m.all_kitchens,
    kitchenIds: (m.membership_kitchen ?? []).map((k) => k.kitchen_id),
    account: { id: m.account.id, code: m.account.code, name: m.account.name, isSynthetic: m.account.is_synthetic },
  };
});

export interface PortalRequirement {
  /** 04 §5 row the screen or action needs. */
  action?: PortalAction;
  /** Profiles allowed when the 04 §5 table has no row for the screen (written down in the report). */
  roles?: readonly MemberRole[];
  /** A05: the screen shows when any of these flags is on for the account; otherwise 404. */
  flags?: readonly FlagKey[];
}

/** No session: to P15 (/entrar). Signed in without the profile or flag: 404, never 403 (05 intro). */
export async function requirePortal(req: PortalRequirement = {}): Promise<PortalMember> {
  const m = await portalMember();
  if (!m) redirect("/entrar");
  if (req.action && !canPortal(m.role, req.action)) notFound();
  if (req.roles && !req.roles.includes(m.role)) notFound();
  if (req.flags?.length) {
    const on = await Promise.all(req.flags.map((k) => isEnabled(k, m.account.id)));
    if (!on.some(Boolean)) notFound();
  }
  return m;
}

export interface PersonAudit {
  action: string;
  entity: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

/** A04: every write by a person writes audit_log, with ip and user agent. */
export async function auditPerson(db: Db, m: PortalMember, a: PersonAudit): Promise<void> {
  const meta = await requestMeta();
  const { error } = await db.from("audit_log").insert({
    actor_person_id: m.personId,
    actor_kind: "person",
    account_id: m.account.id,
    action: a.action,
    entity: a.entity,
    entity_id: a.entityId,
    before: (a.before ?? null) as Json,
    after: (a.after ?? null) as Json,
    ip: meta.ip,
    user_agent: meta.userAgent,
  });
  if (error) throw new Error(error.message);
}

/** E04: end of the account's active security_lock (ISO), or null when changes are open. */
export async function peopleLockUntil(db: Db, accountId: string): Promise<string | null> {
  const { data, error } = await db.rpc("people_lock_until", { p_account: accountId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** "https://app.margoai..." of this request, for links the owner sends from their phone (invites, W07). */
export async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
