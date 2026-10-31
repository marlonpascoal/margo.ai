// POST /api/extension/pair {code}: the extension exchanges the short code from the portal (W07) or console
// (C07) for its long token, once (06 §9). No session: the code is the proof. Flag m2.extensao_chrome.
import { isEnabled } from "@/lib/flags";
import { pairExtension } from "@/lib/extension/server";
import { adminClient } from "@/lib/supabase/admin";
import { json, metaOf } from "../request";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const r = await pairExtension(adminClient(), typeof body?.code === "string" ? body.code : "", (id) => isEnabled("m2.extensao_chrome", id), metaOf(req), new Date());
  return r.ok ? json({ token: r.token, account: r.accountName }) : json({ error: r.message }, r.status);
}
