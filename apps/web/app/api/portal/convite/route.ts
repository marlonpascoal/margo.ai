// POST P18 "Aceitar e entrar": membership from the invite, then the session. An e-mail invite opens the
// session at once (the link proved the address); a WhatsApp invite sends a code to the e-mail the person
// gave, since login codes go by e-mail until the WhatsApp Business Platform (auth.whatsapp_code, D36).
import { NextResponse, type NextRequest } from "next/server";
import { loginDeps } from "@/lib/auth/deps";
import { sendCode } from "@/lib/auth/login";
import { deviceCookie, requestContext } from "@/lib/auth/request";
import { SupabaseLoginStore } from "@/lib/auth/supabase-store";
import { requestMeta } from "@/lib/console/request";
import { notifyDeps } from "@/lib/notify/deps";
import { acceptInvite } from "@/lib/portal/entry";
import { openInviteSession } from "@/lib/portal/invite-session";
import { accountCookie } from "@/lib/portal/cookies";
import { adminClient } from "@/lib/supabase/admin";
import { sessionClient } from "@/lib/supabase/server";

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ ok: false }, { status: 400 });
  const db = adminClient();
  const r = await acceptInvite(
    { db, notify: notifyDeps() },
    { token: str(b.token), name: str(b.name), email: str(b.email) || undefined, terms: b.terms === true },
    await requestMeta(),
  );
  if (!r.ok) return NextResponse.json(r, { status: 400 });

  if (r.channel === "whatsapp") {
    const sent = await sendCode(await loginDeps(), { email: r.email, surface: "portal" });
    const res = NextResponse.json({ ok: true, code: true, email: r.email, message: sent.message });
    res.cookies.set(accountCookie(r.accountId));
    return res;
  }

  const ctx = requestContext(req);
  const opened = await openInviteSession(db, await sessionClient(), new SupabaseLoginStore(db), r.email, ctx);
  const res = NextResponse.json(opened ? { ok: true, next: "/app" } : { ok: true, next: "/entrar" });
  res.cookies.set(accountCookie(r.accountId));
  if (ctx.isNew) res.cookies.set(deviceCookie(ctx.deviceKey));
  return res;
}
