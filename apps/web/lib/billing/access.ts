// /app/plano access (05 P09/W05, 04 §5 "Plan, card and invoices": Dono only). Server-side, on every page
// render and every server action; the portal shell is not this page's permission check.
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import { canPortal, type MemberRole } from "@/lib/permissions";
import { adminClient } from "@/lib/supabase/admin";

export interface PlanOwner {
  personId: string;
  accountId: string;
}

interface Membership {
  account_id: string;
  role: MemberRole;
  created_at: string;
}

/**
 * The account whose plan the person sees: the only membership, else the oldest one. Not a permission
 * decision: the role is checked on that account right after.
 */
export function pickAccount(memberships: Membership[]): Membership | null {
  return [...memberships].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.account_id.localeCompare(b.account_id))[0] ?? null;
}

/** No portal session: to /entrar (P15). A session without the Dono role on the account: 404, never 403 (05 intro). */
export const requirePlanOwner = cache(async (): Promise<PlanOwner> => {
  const session = await currentSession("portal");
  if (!session) redirect("/entrar");
  const { data, error } = await adminClient().from("membership").select("account_id, role, created_at").eq("person_id", session.personId);
  if (error) throw new Error(error.message);
  const m = pickAccount(data ?? []);
  if (!m || !canPortal(m.role, "billing")) notFound();
  return { personId: session.personId, accountId: m.account_id };
});
