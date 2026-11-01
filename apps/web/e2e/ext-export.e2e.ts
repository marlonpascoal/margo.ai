// P04 daily send end to end (05 P04, 06 §9, C07 "Envia sozinha uma vez por dia"): the built extension loaded in
// Chromium, on a SYNTHETIC Partner Portal page (fixtures/m2/extension/portal-SINTETICO.html, not iFood's DOM)
// served at the portal URL by Playwright routing, so nothing reaches iFood. The content script clicks Export,
// captures the file and the background sends it to the local server with the extension token. Once a day.
// Leaves G-SYN as seeded.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Worker } from "@playwright/test";
import { buildExtension } from "./extension-helpers";
import { adminDb, ARTIFACTS, ROOT, sid } from "./helpers";

const PORTAL = "https://portal.ifood.com.br";
const PAGE = readFileSync(path.join(ROOT, "fixtures/m2/extension/portal-SINTETICO.html"), "utf8");
const CSV = "SINTÉTICO\nPedido;Item;Quantidade;Valor\n1001;X-Bacon;2;59,80\n";

/** chrome.storage.local inside the extension's service worker. */
type Ext = { chrome: { tabs: { query(q: object): Promise<{ id: number; url?: string }[]>; sendMessage(id: number, m: object): Promise<unknown> }; storage: { local: { get(k: string[]): Promise<Record<string, unknown>>; set(o: object): Promise<void>; remove(k: string[]): Promise<void> } } } };

let context: BrowserContext;
let worker: Worker;
let profile: string;
const created: { tokens: string[] } = { tokens: [] };

async function extensionRuns() {
  const { data } = await adminDb().from("import_run").select("id, job_id, file_name, store_ids, created_by, log").eq("account_id", sid("G-01")).eq("trigger", "extension");
  return data ?? [];
}

async function clearRuns() {
  const db = adminDb();
  const runs = await extensionRuns();
  if (!runs.length) return;
  await db.from("audit_log").delete().in("entity_id", runs.map((r) => r.id));
  await db.from("import_run").delete().in("id", runs.map((r) => r.id));
  const jobs = runs.map((r) => r.job_id).filter(Boolean) as string[];
  if (jobs.length) await db.from("job").delete().in("id", jobs);
}

test.beforeAll(async ({ baseURL }) => {
  const dir = path.join(ARTIFACTS, "extension-export-e2e");
  buildExtension(baseURL!, dir);
  profile = mkdtempSync(path.join(os.tmpdir(), "margo-ext-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

  // A paired token of the G-01 owner, kept where the popup keeps it after pairing.
  const token = `mgx_${randomBytes(24).toString("hex")}`;
  const { data } = await adminDb()
    .from("extension_token")
    .insert({ person_id: sid("p:g01-dono"), account_id: sid("G-01"), token_hash: createHash("sha256").update(token).digest("hex"), paired_at: new Date().toISOString() })
    .select("id")
    .single();
  created.tokens.push(data!.id);
  await worker.evaluate((t) => (globalThis as unknown as Ext).chrome.storage.local.set({ token: t }), token);

  await context.route(`${PORTAL}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/financeiro/arquivo/")) return route.fulfill({ status: 200, contentType: "text/csv", body: CSV });
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE });
  });
});

test.afterAll(async () => {
  await clearRuns();
  const db = adminDb();
  if (created.tokens.length) {
    await db.from("audit_log").delete().in("entity_id", created.tokens);
    await db.from("extension_token").delete().in("id", created.tokens);
  }
  await context?.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

const forgetToday = () => worker.evaluate(() => (globalThis as unknown as Ext).chrome.storage.local.remove(["dailyAttempt"]));
const attemptDay = () => worker.evaluate(async () => (await (globalThis as unknown as Ext).chrome.storage.local.get(["dailyAttempt"])).dailyAttempt ?? null);

test("C01_P04_daily_send_clicks_export_on_the_open_portal_page_and_sends_the_file_once_a_day", async () => {
  await clearRuns();
  const page = await context.newPage();
  await page.goto(`${PORTAL}/financeiro/conciliacao`);

  await expect.poll(async () => (await extensionRuns()).length, { timeout: 30_000 }).toBe(1);
  const [run] = await extensionRuns();
  expect(run).toMatchObject({
    file_name: "vendas-por-item-SINTETICO.csv",
    created_by: sid("p:g01-dono"),
    log: { reports: ["vendas_por_item", "promocoes"] },
  });
  expect(run.store_ids).toHaveLength(1); // G-01 has one store: the file goes with it
  expect(await attemptDay()).not.toBeNull();

  // Same day, page opened again: nothing more is sent.
  await page.reload();
  await page.getByRole("button", { name: "Exportar" }).waitFor();
  await page.waitForTimeout(3000);
  expect(await extensionRuns()).toHaveLength(1);
  await page.close();
});

test("C01_P04_daily_send_reads_a_download_link_on_the_portal_like_the_page_would", async () => {
  await clearRuns();
  await forgetToday();
  const page = await context.newPage();
  await page.goto(`${PORTAL}/financeiro/link`);
  await expect.poll(async () => (await extensionRuns()).length, { timeout: 30_000 }).toBe(1);
  expect((await extensionRuns())[0].file_name).toBe("vendas-por-item-SINTETICO.csv");
  await page.close();
});

test("P04_without_an_export_button_or_off_the_financial_pages_nothing_is_clicked_or_sent", async () => {
  await clearRuns();
  await forgetToday();
  const page = await context.newPage();
  await page.goto(`${PORTAL}/financeiro/sem-botao`);
  await page.goto(`${PORTAL}/cardapio/link`);
  await page.getByRole("button", { name: "Exportar" }).waitFor();
  await page.waitForTimeout(3000);
  expect(await extensionRuns()).toHaveLength(0);
  expect(await attemptDay()).toBeNull();
  await page.close();
});

test("C01_P04_popup_request_makes_the_content_script_click_export_and_hand_over_the_file", async () => {
  const page = await context.newPage();
  await page.goto(`${PORTAL}/cardapio/conciliacao`);
  await page.getByRole("button", { name: "Exportar" }).waitFor();
  // What the popup sends to the portal tab (popup.ts), here from the extension's own worker.
  const reply = await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as Ext;
    const [tab] = (await chrome.tabs.query({})).filter((t) => t.url?.includes("/cardapio/"));
    return chrome.tabs.sendMessage(tab.id, { type: "margoai:export-now" });
  });
  expect(reply).toMatchObject({ ok: true, file: { name: "vendas-por-item-SINTETICO.csv", type: "text/csv" } });
  expect(Buffer.from((reply as { file: { base64: string } }).file.base64, "base64").toString()).toContain("1001;X-Bacon;2;59,80");
  expect(await extensionRuns()).toHaveLength(0); // the popup sends it, not the content script
  await page.close();
});
