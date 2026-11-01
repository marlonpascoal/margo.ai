// P04 on the Partner Portal page (05 P04, 06 §9, D01a): find the Export button, click it, capture the file the
// portal hands over, once a day. Written against small interfaces so the tests run in Node; content.ts gives
// it the real page. Reads nothing else from the page: no form, no cookie, no password.
import type { Status } from "./api";
import { PORTAL_EXPORT, PORTAL_ORIGIN } from "./config";

export type ExportConfig = typeof PORTAL_EXPORT;

/** The file as it crosses chrome.runtime messaging (JSON only). */
export interface EncodedFile {
  name: string;
  type: string;
  base64: string;
}

export type ExportFailure = "no-button" | "no-download";
export type ExportReply = { ok: true; file: EncodedFile } | { ok: false; reason: ExportFailure };

/** Message the popup sends to the content script of the portal tab. */
export const EXPORT_NOW = "margoai:export-now";
/** Messages the content script sends to the background for the daily send. */
export const DAILY_DUE = "margoai:daily-due";
export const DAILY_CLAIM = "margoai:daily-claim";
export const DAILY_UPLOAD = "margoai:daily-upload";
/** The attribute on <html> that arms hook.ts, and the tag of what it posts back. */
export const ARMED_ATTR = "data-margoai-export";
export const HOOK_TAG = "margoai:export";

/** True on a financial / reconciliation page of the Partner Portal (PORTAL_EXPORT.reportPaths). */
export function onReportPage(url: string | undefined, cfg: Pick<ExportConfig, "reportPaths"> = PORTAL_EXPORT): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.origin === PORTAL_ORIGIN && cfg.reportPaths.some((p) => u.pathname === p || u.pathname.startsWith(`${p.replace(/\/$/, "")}/`));
  } catch {
    return false;
  }
}

export interface ButtonLike {
  textContent: string | null;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  getClientRects?(): { length: number };
  click(): void;
}

export interface QueryRoot {
  querySelectorAll(selector: string): ArrayLike<ButtonLike>;
}

const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
const usable = (b: ButtonLike) =>
  !b.hasAttribute("disabled") && b.getAttribute("aria-disabled") !== "true" && (!b.getClientRects || b.getClientRects().length > 0);

/** The portal's Export button: the configured selectors first, then a button with the configured text. */
export function findExportButton(root: QueryRoot, cfg: Pick<ExportConfig, "buttonSelectors" | "buttonTexts"> = PORTAL_EXPORT): ButtonLike | null {
  for (const sel of cfg.buttonSelectors) {
    for (const b of Array.from(root.querySelectorAll(sel))) if (usable(b)) return b;
  }
  const texts = cfg.buttonTexts.map(norm);
  for (const b of Array.from(root.querySelectorAll('button, [role="button"]'))) {
    if (usable(b) && texts.includes(norm(b.textContent))) return b;
  }
  return null;
}

/** Polls for the button (the portal renders late) until it appears or the time runs out. */
export async function waitForExportButton(root: QueryRoot, timeoutMs: number, stepMs = 250): Promise<ButtonLike | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const b = findExportButton(root);
    if (b || Date.now() >= deadline) return b;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** "2026-10-31": the São Paulo calendar day. */
export function spDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export interface DailyPlan {
  due: boolean;
  storeId: string | null;
  reports: string[];
}

/**
 * C07 "Envia sozinha uma vez por dia": due when nothing was sent today (São Paulo) and no daily attempt was
 * made today. The file goes with the reports MargoAI asked for, and with the store only when there is one.
 */
export function dailyPlan(st: Status, attemptDay: string | null, now: Date): DailyPlan {
  const today = spDay(now);
  const sentToday = st.lastUpload !== null && spDay(new Date(st.lastUpload)) === today;
  return {
    due: !sentToday && attemptDay !== today,
    storeId: st.stores.length === 1 ? st.stores[0].id : null,
    reports: st.reports.filter((r) => r.requested).map((r) => r.key),
  };
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The name the upload gets: the portal's own name when it is .csv or .xlsx; otherwise one from the content
 * (an .xlsx is a zip, "PK"), or null when it is neither (the server takes only these two).
 */
export function reportFileName(suggested: string | null | undefined, mime: string, head: Uint8Array, now: Date): string | null {
  const name = (suggested ?? "").split(/[\\/]/).pop()!.trim();
  if (/\.(csv|xlsx)$/i.test(name)) return name;
  let ext: string | null = null;
  if (mime === XLSX || (head[0] === 0x50 && head[1] === 0x4b)) ext = "xlsx";
  else if (/^(text\/csv|application\/csv|text\/plain)/.test(mime)) ext = "csv";
  else if ((mime === "" || mime === "application/octet-stream") && head.length > 0 && !head.some((b) => b === 0)) ext = "csv";
  return ext ? `portal-ifood-${spDay(now)}.${ext}` : null;
}

export async function asReportFile(blob: Blob, suggested: string | null | undefined, now: Date): Promise<File | null> {
  const name = reportFileName(suggested, blob.type.split(";")[0].trim(), new Uint8Array(await blob.slice(0, 512).arrayBuffer()), now);
  if (!name) return null;
  return new File([blob], name, { type: name.endsWith(".xlsx") ? XLSX : "text/csv" });
}

export async function encodeFile(file: File): Promise<EncodedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: file.name, type: file.type, base64: btoa(bin) };
}

export function decodeFile(f: EncodedFile): File {
  const bin = atob(f.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name, { type: f.type });
}

/** What captureExport needs from the page. */
export interface CaptureEnv {
  /** Receives hook.ts messages (window "message"). */
  win: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** Receives clicks on links the portal attaches to the page (capture phase). */
  doc: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** <html>, armed while capturing so hook.ts reports object URLs. */
  root: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void };
  /** The page origin; hook.ts messages from elsewhere are ignored. */
  origin: string;
  /** Reads a link the portal points the download at (blob:, data: or a portal URL), as the page would. */
  fetchUrl(url: string): Promise<Blob>;
  now(): Date;
}

interface HookMessage {
  tag: typeof HOOK_TAG;
  kind: "blob" | "link";
  url: string;
  blob?: Blob;
  name?: string;
}

const isHook = (d: unknown): d is HookMessage => typeof d === "object" && d !== null && (d as HookMessage).tag === HOOK_TAG;

/**
 * Arms the capture, then resolves with the first report file the portal hands over after the click: a Blob it
 * turns into an object URL (hook.ts), or a download link it clicks. Null when nothing comes before the time
 * runs out. Disarms itself either way.
 */
export function captureExport(env: CaptureEnv, timeoutMs: number, nameWaitMs = 300): Promise<File | null> {
  return new Promise((resolve) => {
    const names = new Map<string, string>();
    const fetched = new Set<string>();
    let settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      env.win.removeEventListener("message", onMessage);
      env.doc.removeEventListener("click", onClick, true);
      env.root.removeAttribute(ARMED_ATTR);
      resolve(file);
    };

    const offer = async (blob: Blob, url: string) => {
      // The portal usually names the file on the link it clicks right after creating the URL.
      if (!names.has(url)) await new Promise((r) => timers.push(setTimeout(r, nameWaitMs)));
      if (settled) return;
      const file = await asReportFile(blob, names.get(url), env.now());
      if (file && file.size > 0) finish(file);
    };

    const link = (url: string, name: string | null) => {
      if (name) names.set(url, name);
      if (url.startsWith("blob:") || fetched.has(url)) return; // the Blob arrives through hook.ts
      if (!/^(https?:|data:)/.test(url) || !(name !== null || url.startsWith("data:"))) return;
      fetched.add(url);
      env.fetchUrl(url).then(
        (blob) => offer(blob, url),
        () => undefined,
      );
    };

    function onMessage(ev: Event) {
      const { data, origin } = ev as MessageEvent;
      if (origin !== env.origin || !isHook(data)) return;
      if (data.kind === "blob" && data.blob) void offer(data.blob, data.url);
      if (data.kind === "link") link(data.url, data.name ?? null);
    }

    function onClick(ev: Event) {
      const a = (ev.target as { closest?: (s: string) => { getAttribute(n: string): string | null; href?: string } | null } | null)?.closest?.("a[href]");
      if (!a) return;
      const url = a.href ?? a.getAttribute("href") ?? "";
      const name = a.getAttribute("download");
      if (name !== null || url.startsWith("blob:") || url.startsWith("data:")) link(url, name);
    }

    env.win.addEventListener("message", onMessage);
    env.doc.addEventListener("click", onClick, true);
    env.root.setAttribute(ARMED_ATTR, "armed");
    timers.push(setTimeout(() => finish(null), timeoutMs));
  });
}

/** Click Export on the open page and capture the file: what both the popup and the daily send do. */
export async function exportFromPage(page: QueryRoot, env: CaptureEnv, waitForButtonMs: number, beforeClick?: () => Promise<boolean>): Promise<ExportReply | null> {
  const button = await waitForExportButton(page, waitForButtonMs);
  if (!button) return { ok: false, reason: "no-button" };
  if (beforeClick && !(await beforeClick())) return null;
  const capture = captureExport(env, PORTAL_EXPORT.waitForDownloadMs);
  button.click();
  const file = await capture;
  return file ? { ok: true, file: await encodeFile(file) } : { ok: false, reason: "no-download" };
}
