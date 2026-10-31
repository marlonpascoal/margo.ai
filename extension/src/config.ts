// P04 (06 §9, D01a): the two hosts the extension may talk to. The manifest's host permissions are these and
// nothing else (05 P04 "Done when"). The Partner Portal host is the iFood one the owner logs into.
import { PARTNER_PORTAL_ORIGIN } from "@margoai/contracts";

export const PORTAL_ORIGIN = PARTNER_PORTAL_ORIGIN;
export const API_BASE: string = typeof __MARGO_API__ === "string" ? __MARGO_API__ : "http://localhost:3000";

/** The manifest's host_permissions, from the two origins. */
export function hostPermissions(apiBase: string): string[] {
  return [`${PORTAL_ORIGIN}/*`, `${new URL(apiBase).origin}/*`];
}
