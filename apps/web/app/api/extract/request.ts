// Shared by /api/extract/*: the token, the size limit and the JSON answers (docs/extract-api.md).
import { NextResponse } from "next/server";
import { extractAuthorized, MAX_BODY_BYTES } from "@/lib/extract/server";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** The parsed body, or the answer that refuses the request (401, 413, 422). */
export async function readRequest(req: Request): Promise<{ body: Record<string, unknown> } | { refused: NextResponse }> {
  if (!extractAuthorized(req.headers.get("authorization"))) return { refused: json({ error: "bad token" }, 401) };
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return { refused: json({ error: "too large" }, 413) };
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return { refused: json({ error: "too large" }, 413) };
  try {
    const body: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (typeof body === "object" && body !== null && !Array.isArray(body)) return { body: body as Record<string, unknown> };
  } catch {
    // Answered below.
  }
  return { refused: json({ errors: ["body: must be a JSON object"] }, 422) };
}
