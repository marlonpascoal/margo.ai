// Owner portal access (02 §5, 04 §5, §8): a valid portal session (30 days) of a person with a membership.
// The one place that resolves which account a /app page or action acts on: the margo_conta cookie, else
// the only membership, else the P15 chooser. Every portal page, route and server action calls
// requireMember() or requirePortal() itself and checks its own 04 §5 row; the /app layout calls it too, but
// the layout is not the permission check.
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import { requestMeta } from "@/lib/console/request";
import { isEnabled, type FlagKey } from "@/lib/flags";
import { canPortal, type MemberRole, type PortalAction } from "@/lib/permissions";
import { adminClient, type Db } from "@/lib/supabase/admin";

/** Which account the person opened, when they belong to more than one (P15). Checked on every read. */
export const ACCOUNT_COOKIE = "margo_conta";

export interface MembershipChoice {
  accountId: string;
  accountName: string;
  role: MemberRole;
}

export interface Member {
  personId: string;
  sessionDeviceId: string;
  name: string;
  email: string | null;
  whatsappE164: string | null;
  account: { id: string; name: string; code: string; isSynthetic: boolean; trialEndsAt: Date | null };
  role: MemberRole;
  /** All kitchens of the account, or only those in membership_kitchen (04 §5). */
  allKitchens: boolean;
  /** Kitchens this person may see: every kitchen of the account when allKitchens. */
  kitchenIds: string[];
  /** The person belongs to more than one account (shows "Trocar de grupo"). */
  manyAccounts: boolean;
}

/** P15: the account to open. One membership opens directly; several need the cookie, else the chooser. */
export function pickAccount(memberships: MembershipChoice[], chosen: string | undefined): string | "choose" | null {
  if (memberships.length === 0) return null;
  if (chosen && memberships.some((m) => m.accountId === chosen)) return chosen;
  return memberships.length === 1 ? memberships[0].accountId : "choose";
}

export async function membershipsOf(db: Db, personId: string): Promise<MembershipChoice[]> {
  const { data, error } = await db.from("membership").select("account_id, role, account(name)").eq("person_id", personId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((m) => ({ accountId: m.account_id, accountName: m.account?.name ?? "", role: m.role }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName, "pt-BR"));
}

type Resolved = { kind: "none" } | { kind: "choose"; personId: string } | { kind: "member"; member: Member };

const resolve = cache(async (): Promise<Resolved> => {
  const session = await currentSession("portal");
  if (!session) return { kind: "none" };
  const db = adminClient();
  const memberships = await membershipsOf(db, session.personId);
  const picked = pickAccount(memberships, (await cookies()).get(ACCOUNT_COOKIE)?.value);
  if (picked === null) return { kind: "none" };
  if (picked === "choose") return { kind: "choose", personId: session.personId };

  const [{ data: person }, { data: m }, { data: kitchens }] = await Promise.all([
    db.from("person").select("name, email, whatsapp_e164").eq("id", session.personId).single(),
    db
      .from("membership")
      .select("role, all_kitchens, membership_kitchen(kitchen_id), account(id, name, code, is_synthetic, trial_ends_at)")
      .eq("person_id", session.personId)
      .eq("account_id", picked)
      .single(),
    db.from("kitchen").select("id").eq("account_id", picked),
  ]);
  if (!person || !m || !m.account) return { kind: "none" };
  const accountKitchens = (kitchens ?? []).map((k) => k.id);
  const own = new Set(m.membership_kitchen.map((k) => k.kitchen_id));
  return {
    kind: "member",
    member: {
      personId: session.personId,
      sessionDeviceId: session.sessionDeviceId,
      name: person.name,
      email: person.email,
      whatsappE164: person.whatsapp_e164,
      account: {
        id: m.account.id,
        name: m.account.name,
        code: m.account.code,
        isSynthetic: m.account.is_synthetic,
        trialEndsAt: m.account.trial_ends_at ? new Date(m.account.trial_ends_at) : null,
      },
      role: m.role,
      allKitchens: m.all_kitchens,
      kitchenIds: m.all_kitchens ? accountKitchens : accountKitchens.filter((id) => own.has(id)),
      manyAccounts: memberships.length > 1,
    },
  };
});

/** The signed-in member of the open account, or null (no session, or an account still to choose). */
export async function portalMember(): Promise<Member | null> {
  const r = await resolve();
  return r.kind === "member" ? r.member : null;
}

/** The signed-in portal person, even before choosing an account (P15 chooser). */
export async function portalPersonId(): Promise<string | null> {
  const r = await resolve();
  return r.kind === "member" ? r.member.personId : r.kind === "choose" ? r.personId : null;
}

/** No session: to P15. Several accounts and none chosen: to the chooser. */
export async function requireMember(): Promise<Member> {
  const r = await resolve();
  if (r.kind === "none") redirect("/entrar");
  if (r.kind === "choose") redirect("/entrar/conta");
  return r.member;
}

export interface PortalRequirement {
  /** 04 §5 row the screen or action needs. */
  action?: PortalAction;
  /** Profiles allowed when the 04 §5 table has no row for the screen. */
  roles?: readonly MemberRole[];
  /** A05: the screen shows when any of these flags is on for the account; otherwise 404. */
  flags?: readonly FlagKey[];
}

/** 04 §5 profile part of a requirement (flags are checked against the account separately). */
export function roleAllowed(role: MemberRole, req: PortalRequirement): boolean {
  if (req.action && !canPortal(role, req.action)) return false;
  if (req.roles && !req.roles.includes(role)) return false;
  return true;
}

/**
 * requireMember() plus the screen's own check: signed in without the profile or with every listed flag
 * off answers 404, never 403 (05 intro).
 */
export async function requirePortal(req: PortalRequirement = {}): Promise<Member> {
  const m = await requireMember();
  if (!roleAllowed(m.role, req)) notFound();
  if (req.flags?.length) {
    const on = await Promise.all(req.flags.map((k) => isEnabled(k, m.account.id)));
    if (!on.some(Boolean)) notFound();
  }
  return m;
}

/** "https://app.margoai...": MARGO_APP_URL on the platform, else this request's own origin (invites, W07, Asaas return). */
export async function appOrigin(): Promise<string> {
  if (process.env.MARGO_APP_URL) return process.env.MARGO_APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** auditMember() with this request's ip and user agent. */
export async function auditPerson(
  db: Db,
  m: Pick<Member, "personId" | "account">,
  a: { action: string; entity: string; entityId: string | null; before?: unknown; after?: unknown },
): Promise<void> {
  await auditMember(db, m, { ...a, meta: await requestMeta() });
}

/** A04 audit row for a portal write by this member. */
export async function auditMember(
  db: Db,
  m: Pick<Member, "personId" | "account">,
  a: { action: string; entity: string; entityId: string | null; before?: unknown; after?: unknown; meta: { ip: string | null; userAgent: string | null } },
): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    actor_person_id: m.personId,
    actor_kind: "person",
    account_id: m.account.id,
    action: a.action,
    entity: a.entity,
    entity_id: a.entityId,
    before: (a.before ?? null) as never,
    after: (a.after ?? null) as never,
    ip: a.meta.ip,
    user_agent: a.meta.userAgent,
  });
  if (error) throw new Error(error.message);
}
