"use server";
// P15 "escolhe qual abrir depois de entrar": only an account the person belongs to (checked here).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accountCookie } from "@/lib/portal/cookies";
import { membershipsOf, portalPersonId } from "@/lib/portal/session";
import { sessionReader } from "@/lib/supabase/server";

export async function chooseAccount(form: FormData): Promise<void> {
  const personId = await portalPersonId();
  if (!personId) redirect("/entrar");
  const accountId = String(form.get("account") ?? "");
  const memberships = await membershipsOf(await sessionReader(null), personId);
  if (!memberships.some((m) => m.accountId === accountId)) redirect("/entrar/conta");
  (await cookies()).set(accountCookie(accountId));
  redirect("/app");
}
