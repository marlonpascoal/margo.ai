// P23 "Baixar PDF" (Marlon, 07/nov: the PDF is the result screen printed). The person asks from the result page; the
// route checks them (RLS read of the monitoring, see_xray, m1.portal) and calls requestPrint: a copy already printed for
// this result `version` is served at once, otherwise a render_xray job in print mode is queued (deduplicated per
// version) and worker-render prints /imprimir/raio-x/[xray] with Playwright, opening it with a one-time token it minted
// (only its sha256 is stored, 5 minutes). The console's P01 (xray.pdf_path, C05/C06) is a different path, unchanged.
import { createHash } from "node:crypto";

export interface PrintDeps {
  /** The cached copy of this run and version: storage path in the private pdf bucket, or null. */
  printed(xrayId: string, version: string): Promise<{ path: string; pages: number } | null>;
  enqueue(job: { type: "render_xray"; payload: Record<string, unknown>; accountId: string; dedupeKey: string }): Promise<{ jobId: string; deduped: boolean }>;
  /** xray_print_token_use: true once for a fresh token of this run. */
  useToken(xrayId: string, tokenHash: string): Promise<boolean>;
}

export type PrintState = { state: "ready"; path: string; pages: number } | { state: "preparing"; jobId: string; deduped: boolean };

/** Print layout version: bump it when the printed page changes, so copies printed with an older layout are not served. */
export const PRINT_LAYOUT = "3";

/** The cache version of a printed copy: the result version plus the print layout (the print page reports the same). */
export const printVersion = (resultVersion: string) => `${resultVersion}.l${PRINT_LAYOUT}`;

/** Dedupe key of a print job: one per run and version while queued or running. */
export const printDedupeKey = (xrayId: string, version: string) => `render_xray:print:${xrayId}:${version}`;

/** The printed copy for this version, or a print job for it. */
export async function requestPrint(deps: PrintDeps, r: { xrayId: string; version: string; accountId: string }): Promise<PrintState> {
  const done = await deps.printed(r.xrayId, r.version);
  if (done) return { state: "ready", ...done };
  const job = await deps.enqueue({
    type: "render_xray",
    payload: { xray_id: r.xrayId, mode: "print", version: r.version },
    accountId: r.accountId,
    dedupeKey: printDedupeKey(r.xrayId, r.version),
  });
  return { state: "preparing", jobId: job.jobId, deduped: job.deduped };
}

/** sha256 hex of a print token, as worker-render stores it. */
export const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** The print page opens only with a fresh token of this run (used once). */
export async function printTokenValid(deps: Pick<PrintDeps, "useToken">, xrayId: string, token: string | undefined | null): Promise<boolean> {
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return false;
  return deps.useToken(xrayId, tokenHash(token));
}

/** "raio-x-loja-exemplo-2026-11-02.pdf". */
export function pdfFileName(storeName: string, on: string): string {
  const slug = storeName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `raio-x-${slug || "loja"}-${on}.pdf`;
}
