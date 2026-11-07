// POST {surface, all?}: signs out this session, or every session of the person (W09).
import { NextResponse, type NextRequest } from "next/server";
import { parseSurface } from "@/lib/auth/request";
import { currentSession, signOutDevice, signOutEverywhere } from "@/lib/auth/session";
import { adminClient } from "@/lib/supabase/admin";
import { sessionClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const surface = parseSurface(body?.surface);
  if (!surface) return NextResponse.json({ ok: false }, { status: 400 });
  const session = await currentSession(surface);
  const supabase = await sessionClient();
  if (session) {
    const db = adminClient();
    const { data: memberships } = await db.from("membership").select("account_id").eq("person_id", session.personId);
    const accountIds = (memberships ?? []).map((m) => m.account_id);
    if (body?.all === true) {
      await signOutEverywhere(db, session.personId, accountIds);
      await supabase.auth.signOut({ scope: "global" });
      return NextResponse.json({ ok: true });
    }
    await signOutDevice(db, session, surface, accountIds);
  }
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.json({ ok: true });
}
