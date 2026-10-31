// Console access: a valid console session (04 §8, 12 hours) of a person in `staff` (02 §5).
// Every console page and server action calls requireConsole() with its 04 §5 area.
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import { canConsole, type ConsoleArea, type StaffRole } from "@/lib/permissions";
import { adminClient } from "@/lib/supabase/admin";

export interface ConsoleStaff {
  personId: string;
  name: string;
  role: StaffRole;
}

/** The signed-in staff member, or null. Cached per request. */
export const consoleStaff = cache(async (): Promise<ConsoleStaff | null> => {
  const session = await currentSession("console");
  if (!session) return null;
  const { data } = await adminClient().from("staff").select("role, person!staff_person_id_fkey(name)").eq("person_id", session.personId).maybeSingle();
  if (!data) return null;
  return { personId: session.personId, name: data.person?.name ?? "", role: data.role };
});

/** No session: to C00. Session without the role for this area: 404, never 403 (05 intro). */
export async function requireConsole(area: ConsoleArea): Promise<ConsoleStaff> {
  const staff = await consoleStaff();
  if (!staff) redirect("/console/login");
  if (!canConsole(staff.role, area)) notFound();
  return staff;
}
