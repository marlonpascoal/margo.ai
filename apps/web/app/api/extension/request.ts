// Shared by the extension endpoints (06 §9): who called (audit_log ip and user agent) and JSON answers.
import { NextResponse } from "next/server";

export function metaOf(req: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || req.headers.get("x-real-ip") || null, userAgent: req.headers.get("user-agent") };
}

/** Never cached: tokens and account data. */
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** A05: with the flag off the extension endpoints answer 404, as screens do. */
export const notFound = () => json({ error: "não encontrado" }, 404);
