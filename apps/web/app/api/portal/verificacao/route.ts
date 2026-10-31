// POST P17 "Perdi o acesso ao e-mail e ao WhatsApp": an alert for the founders (04 §8). Same answer for
// every CNPJ, client or not.
import { NextResponse, type NextRequest } from "next/server";
import { requestMeta } from "@/lib/console/request";
import { alertDeps } from "@/lib/notify/deps";
import { requestVerification } from "@/lib/portal/entry";
import { adminClient } from "@/lib/supabase/admin";

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ ok: false }, { status: 400 });
  const r = await requestVerification({ db: adminClient(), alerts: alertDeps() }, { cnpj: str(b.cnpj), contact: str(b.contact) }, await requestMeta());
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
