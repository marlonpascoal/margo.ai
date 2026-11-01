// P04 (06 §9, D01a): the two hosts the extension may talk to. The manifest's host permissions are these and
// nothing else (05 P04 "Done when"). The Partner Portal host is the iFood one the owner logs into.
import { PARTNER_PORTAL_ORIGIN } from "@margoai/contracts";

export const PORTAL_ORIGIN = PARTNER_PORTAL_ORIGIN;
export const API_BASE: string = typeof __MARGO_API__ === "string" ? __MARGO_API__ : "http://localhost:3000";

/** The manifest's host_permissions, from the two origins. */
export function hostPermissions(apiBase: string): string[] {
  return [`${PORTAL_ORIGIN}/*`, `${new URL(apiBase).origin}/*`];
}

/**
 * Where and how the content script clicks the Partner Portal's Export button (05 P04, 06 §9).
 *
 * NOT CONFIRMED ON THE REAL PORTAL. We have no recording of the portal's page, so the paths, selectors and
 * button texts below are a guess. The tests run against a synthetic page (fixtures/m2/extension), which is
 * not a copy of iFood's. Marlon checks these on the real portal (fixtures/m2/extension/README.md). They live
 * here and nowhere else. When nothing matches, the popup falls back to the owner picking the file.
 */
export const PORTAL_EXPORT = {
  /** Path prefixes of the financial / reconciliation pages where the extension may act. */
  reportPaths: ["/financeiro"],
  /** CSS selectors tried in order; the first visible, enabled match is the Export button. */
  buttonSelectors: ['[data-testid="export-button"]', 'button[aria-label="Exportar"]'],
  /** Then any button whose own text is one of these (spaces and case ignored). */
  buttonTexts: ["Exportar", "Exportar relatório"],
  /** How long the daily send waits for the button to appear after the page opens. */
  waitForButtonMs: 15_000,
  /** How long the popup waits for the button before asking the owner for the file. */
  popupWaitForButtonMs: 1_500,
  /** How long after the click the download may take. */
  waitForDownloadMs: 30_000,
} as const;
