// P04 content script, only on the Partner Portal host (manifest). Acts only on the page the owner opened
// (D01a, hard rule 5): no navigation, no other tab, no login, no captcha, nothing read from the page but the
// Export button and the file it produces.
//   - Daily send (C07 "Envia sozinha uma vez por dia"): on a financial page, if nothing was sent today, click
//     Export once and send the file through the background (our API, extension token).
//   - Popup "Exportar e enviar": click Export now and hand the file to the popup, which sends it.
import { PORTAL_EXPORT } from "./config";
import { DAILY_CLAIM, DAILY_DUE, DAILY_UPLOAD, EXPORT_NOW, exportFromPage, onReportPage, type CaptureEnv, type DailyPlan, type ExportReply } from "./portal";

const env = (): CaptureEnv => ({
  win: window,
  doc: document,
  root: document.documentElement,
  origin: location.origin,
  fetchUrl: async (url) => {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`download ${res.status}`);
    return res.blob();
  },
  now: () => new Date(),
});

let busy = false;

async function once<T>(work: () => Promise<T>): Promise<T | null> {
  if (busy) return null;
  busy = true;
  try {
    return await work();
  } finally {
    busy = false;
  }
}

async function daily(): Promise<void> {
  if (!onReportPage(location.href)) return;
  await once(async () => {
    const plan = await chrome.runtime.sendMessage<DailyPlan | null>({ type: DAILY_DUE }).catch(() => null);
    if (!plan?.due) return;
    // Claimed just before the click, so a failed export is not retried in a loop today; a missing button
    // claims nothing and the next financial page tries again.
    const claim = () => chrome.runtime.sendMessage<boolean>({ type: DAILY_CLAIM }).catch(() => false);
    const r = await exportFromPage(document, env(), PORTAL_EXPORT.waitForButtonMs, claim);
    if (r?.ok) await chrome.runtime.sendMessage({ type: DAILY_UPLOAD, file: r.file, storeId: plan.storeId, reports: plan.reports }).catch(() => null);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || (msg as { type?: string })?.type !== EXPORT_NOW) return;
  void once(() => exportFromPage(document, env(), PORTAL_EXPORT.popupWaitForButtonMs)).then((r: ExportReply | null) =>
    reply(r ?? ({ ok: false, reason: "no-download" } satisfies ExportReply)),
  );
  return true;
});

// The portal is a single-page app: watch for the owner moving to a financial page.
let seen = "";
function onNavigate() {
  if (location.href === seen) return;
  seen = location.href;
  void daily();
}
onNavigate();
setInterval(onNavigate, 1000);
