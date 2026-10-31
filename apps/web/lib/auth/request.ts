// Request parsing shared by the auth routes.
import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { RequestContext } from "./login";
import type { Surface } from "./rules";

export const DEVICE_COOKIE = "margo_device";
const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export function parseSurface(value: unknown): Surface | null {
  return value === "console" || value === "portal" ? value : null;
}

/** Reads or creates the device key; the caller sets the cookie when `isNew`. */
export function requestContext(req: NextRequest): RequestContext & { isNew: boolean } {
  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  const city = req.headers.get("x-vercel-ip-city");
  return {
    userAgent: req.headers.get("user-agent"),
    ipCity: city ? decodeURIComponent(city) : null,
    deviceKey: existing ?? randomBytes(32).toString("base64url"),
    isNew: !existing,
  };
}

export const deviceCookie = (value: string) => ({
  name: DEVICE_COOKIE,
  value,
  httpOnly: true,
  secure: process.env.MARGO_ENV !== "local",
  sameSite: "lax" as const,
  path: "/",
  maxAge: DEVICE_COOKIE_MAX_AGE,
});
