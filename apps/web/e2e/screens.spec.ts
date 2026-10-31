// F02: each built console page at 390 px and 1280 px, saved next to the drawing's name for Marlon to compare.
import path from "node:path";
import { test } from "@playwright/test";
import { adminDb, ARTIFACTS, FOUNDER_EMAIL, loginToConsole } from "./helpers";

const OUT = path.join(ARTIFACTS, "screens");
const WIDTHS = [390, 1280];
const SCREENS: [file: string, url: string][] = [
  ["C01-Clientes", "/console"],
  ["C14-Config", "/console/config"],
  ["C20-Funcionalidades", "/console/funcionalidades"],
  ["C21-Alertas", "/console/alertas"],
  ["C07-Conectar", "/console/contas/G-02/importacoes"],
  ["C08-Fechamento", "/console/contas/G-02/fechamento/2026-09"],
  ["C09-Diferencas", "/console/contas/G-02/fechamento/2026-09/diferencas"],
  ["C16-Contestacao", "/console/contas/G-02/contestacoes"],
  ["C19-Estrutura", "/console/contas/G-02/estrutura"],
];

test("F02_C00_login", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/console/login");
    await page.screenshot({ path: path.join(OUT, `C00-Login-${width}.png`), fullPage: true, caret: "initial" });
  }
});

test("F02_C01_C07_C08_C09_C14_C16_C17_C19_C20_C21_as_founder", async ({ page }) => {
  await loginToConsole(page, FOUNDER_EMAIL);
  for (const [file, url] of SCREENS) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.screenshot({ path: path.join(OUT, `${file}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
  // C17: the seeded 99Food upload of 28/out waiting for its new columns.
  const { data } = await adminDb().from("import_run").select("id").eq("status", "needs_mapping").order("created_at").limit(1).single();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/console/importacoes/${data!.id}/corrigir`);
    await page.screenshot({ path: path.join(OUT, `C17-CorrigirImport-${width}.png`), fullPage: true, caret: "initial" });
  }
});
