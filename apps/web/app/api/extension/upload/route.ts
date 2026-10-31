// POST /api/extension/upload (Bearer token, multipart "arquivo", optional "loja" and "relatorio"): the report
// file the owner chose on the Partner Portal page, into the iFood import queue (06 §2, §9; 04 §11). Flag
// m2.extensao_chrome (A05: off is 404), size limit, C06 authorization check, audited (A04).
import { bearer, MAX_UPLOAD_BYTES, UPLOAD_MESSAGES } from "@/lib/extension/core";
import { authenticateExtension, uploadFromExtension } from "@/lib/extension/server";
import { isEnabled } from "@/lib/flags";
import { adminClient } from "@/lib/supabase/admin";
import { json, metaOf, notFound } from "../request";

export async function POST(req: Request) {
  const db = adminClient();
  const auth = await authenticateExtension(db, bearer(req.headers.get("authorization")), new Date());
  if (!auth) return json({ error: UPLOAD_MESSAGES.badToken }, 401);
  if (!(await isEnabled("m2.extensao_chrome", auth.accountId))) return notFound();
  // Refuse before reading the body when the client says it is too large.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) return json({ error: UPLOAD_MESSAGES.tooLarge }, 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get("arquivo");
  const store = form?.get("loja");
  const r = await uploadFromExtension(
    db,
    auth,
    {
      file: file instanceof File ? file : null,
      storeId: typeof store === "string" && store ? store : null,
      reports: (form?.getAll("relatorio") ?? []).filter((v): v is string => typeof v === "string"),
    },
    metaOf(req),
  );
  return r.ok ? json({ importRunId: r.importRunId }, 201) : json({ error: r.message }, r.status);
}
