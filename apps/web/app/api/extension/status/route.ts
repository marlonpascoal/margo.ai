// GET /api/extension/status (Bearer token): P04 connected status, stores, requested reports, last upload.
// Flag m2.extensao_chrome: off answers 404 (A05).
import { bearer, UPLOAD_MESSAGES } from "@/lib/extension/core";
import { authenticateExtension, extensionStatus } from "@/lib/extension/server";
import { isEnabled } from "@/lib/flags";
import { adminClient } from "@/lib/supabase/admin";
import { json, notFound } from "../request";

export async function GET(req: Request) {
  const db = adminClient();
  const now = new Date();
  const auth = await authenticateExtension(db, bearer(req.headers.get("authorization")), now);
  if (!auth) return json({ error: UPLOAD_MESSAGES.badToken }, 401);
  if (!(await isEnabled("m2.extensao_chrome", auth.accountId))) return notFound();
  return json(await extensionStatus(db, auth, now));
}
