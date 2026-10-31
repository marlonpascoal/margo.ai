// POST P07, W06 "Começar meus N dias grátis": creates the account in trial and sends the login code.
// Same answer whether or not the e-mail already had an account (no enumeration).
import { NextResponse, type NextRequest } from "next/server";
import { loginDeps } from "@/lib/auth/deps";
import { requestMeta } from "@/lib/console/request";
import { signUp } from "@/lib/portal/entry";
import { adminClient } from "@/lib/supabase/admin";

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ ok: false }, { status: 400 });
  const result = await signUp(
    adminClient(),
    await loginDeps(),
    { name: str(b.name), restaurant: str(b.restaurant), cnpj: str(b.cnpj), whatsapp: str(b.whatsapp), email: str(b.email), terms: b.terms === true, ref: str(b.ref) || null },
    await requestMeta(),
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
