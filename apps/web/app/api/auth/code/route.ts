// POST {email, surface}: sends a login code (C00, P15, W06). Same answer for every address.
import { NextResponse, type NextRequest } from "next/server";
import { loginDeps } from "@/lib/auth/deps";
import { sendCode } from "@/lib/auth/login";
import { parseSurface } from "@/lib/auth/request";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const surface = parseSurface(body?.surface);
  if (!surface || typeof body?.email !== "string") return NextResponse.json({ ok: false }, { status: 400 });
  const result = await sendCode(await loginDeps(), { email: body.email, surface });
  return NextResponse.json(result, { status: result.ok ? 200 : 429 });
}
