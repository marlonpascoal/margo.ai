// F02: each built console page at 390 px and 1280 px, saved next to the drawing's name for Marlon to compare.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { ARTIFACTS, FOUNDER_EMAIL, adminDb, loginToConsole, runWorker, sid } from "./helpers";

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
  ["C18-BPO", "/console/bpo"],
];

test("F02_C00_login", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/console/login");
    await page.screenshot({ path: path.join(OUT, `C00-Login-${width}.png`), fullPage: true, caret: "initial" });
  }
});

test("F02_C01_C07_C08_C09_C14_C16_C17_C18_C19_C20_C21_E01_E02_as_founder", async ({ page }) => {
  await loginToConsole(page, FOUNDER_EMAIL);
  for (const [file, url] of SCREENS) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.screenshot({ path: path.join(OUT, `${file}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
  // E01, E02: the e-mail as the mail client gets it, at the drawn width (640 px).
  for (const [file, code] of [["E01-EmailFechamento", "close_ready"], ["E02-EmailPrazo", "deadline_soon"]]) {
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(`/console/emails/${code}/html`);
    await page.screenshot({ path: path.join(OUT, `${file}-640.png`), fullPage: true, caret: "initial" });
  }
  // C17: the seeded 99Food upload of 28/out waiting for its new columns.
  const { data } = await adminDb().from("import_run").select("id").eq("status", "needs_mapping").order("created_at").limit(1).single();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/console/importacoes/${data!.id}/corrigir`);
    await page.screenshot({ path: path.join(OUT, `C17-CorrigirImport-${width}.png`), fullPage: true, caret: "initial" });
  }
});

// M1 on the seeded Pantanos X-ray (C02 with the store link filled in, as drawn). C06 shows "Abrir o PDF"
// once worker-render has made P01, which is also saved next to the screenshots.
test("F02_C02_to_C06_and_P01_as_founder", async ({ page }) => {
  const xray = sid("m1:xray:G-01");
  const db = adminDb();
  const { data: x } = await db.from("xray").select("account_id, pdf_path").eq("id", xray).single();
  if (!x!.pdf_path) {
    await db.from("job").insert({ type: "render_xray", payload: { xray_id: xray }, account_id: x!.account_id });
    runWorker("render_xray");
  }
  await loginToConsole(page, FOUNDER_EMAIL);
  const link = "https://www.ifood.com.br/delivery/londrina-pr/pantanos-burguer-igapo/91a9c35d-0000-4000-8000-000000000000";
  const screens: [string, string][] = [
    ["C02-NovoRaioX", `/console/raio-x/novo?link=${encodeURIComponent(link)}`],
    ["C03-Vizinhanca", `/console/raio-x/${xray}/vizinhanca`],
    ["C04-Pareamento", `/console/raio-x/${xray}/pareamento`],
    ["C05-RaioX", `/console/raio-x/${xray}`],
    ["C06-Entrega", `/console/raio-x/${xray}/entrega`],
  ];
  for (const [file, url] of screens) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      if (file === "C02-NovoRaioX") await page.getByText("Loja encontrada").waitFor();
      await page.screenshot({ path: path.join(OUT, `${file}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
  const pdf = await page.request.get(`/console/raio-x/${xray}/pdf`);
  writeFileSync(path.join(OUT, "P01-RaioXPDF.pdf"), await pdf.body());
});
