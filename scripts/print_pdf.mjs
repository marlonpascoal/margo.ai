#!/usr/bin/env node
// worker-render "Baixar PDF" printer (P23 printed, Marlon 07/nov): opens the print page with Playwright's Chromium and
// writes an A4 PDF. Usage: node scripts/print_pdf.mjs <url> <out.pdf>. Prints {"version": "..."} (the page's
// data-version, the result version the copy is cached under). Playwright comes from apps/web (@playwright/test).
// The URL carries a one-time token; it is never logged.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(root, "apps/web/package.json"))("@playwright/test");

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: print_pdf.mjs <url> <out.pdf>");
  process.exit(2);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  if (!res || res.status() !== 200) {
    console.error(JSON.stringify({ error: "print_page_status", status: res?.status() ?? null }));
    process.exit(3);
  }
  const version = await page.locator("main[data-version]").getAttribute("data-version");
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: out, format: "A4", printBackground: true, preferCSSPageSize: true });
  process.stdout.write(JSON.stringify({ version }) + "\n");
} finally {
  await browser.close();
}
