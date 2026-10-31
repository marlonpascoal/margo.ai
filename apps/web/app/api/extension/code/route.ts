// POST /api/extension/code {account}: the signed-in portal person gets a short pairing code for their own
// extension in one of their accounts (W07 "Adicionar ao Chrome" shows it). Portal session only; flag
// m2.extensao_chrome (A05). Audited.
import { currentSession } from "@/lib/auth/session";
import { createPairingCode } from "@/lib/extension/server";
import { isEnabled } from "@/lib/flags";
import { adminClient } from "@/lib/supabase/admin";
import { json, metaOf, notFound } from "../request";

export async function POST(req: Request) {
  const session = await currentSession("portal");
  if (!session) return json({ error: "Entre no portal para conectar a extensão." }, 401);
  const body = (await req.json().catch(() => null)) as { account?: unknown } | null;
  const accountId = typeof body?.account === "string" ? body.account : "";
  if (!/^[0-9a-f-]{36}$/.test(accountId) || !(await isEnabled("m2.extensao_chrome", accountId))) return notFound();
  const r = await createPairingCode(adminClient(), { personId: session.personId, accountId, actor: { personId: session.personId, kind: "person" } }, metaOf(req), new Date());
  return r ? json({ code: r.code, expiresAt: r.expiresAt.toISOString() }) : notFound();
}
