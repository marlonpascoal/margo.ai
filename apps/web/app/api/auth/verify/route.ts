// POST {email, code, surface}: checks the code, opens the session and records the device.
import { NextResponse, type NextRequest } from "next/server";
import { loginDeps } from "@/lib/auth/deps";
import { verifyCode } from "@/lib/auth/login";
import { deviceCookie, parseSurface, requestContext } from "@/lib/auth/request";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const surface = parseSurface(body?.surface);
  if (!surface || typeof body?.email !== "string" || typeof body?.code !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const ctx = requestContext(req);
  const result = await verifyCode(await loginDeps(), { email: body.email, code: body.code, surface, ctx });
  if (!result.ok) return NextResponse.json(result, { status: 401 });
  const res = NextResponse.json({ ok: true, next: surface === "console" ? "/console" : "/app" });
  if (ctx.isNew) res.cookies.set(deviceCookie(ctx.deviceKey));
  return res;
}
