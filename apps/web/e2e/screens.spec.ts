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
];

test("F02_C00_login", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/console/login");
    await page.screenshot({ path: path.join(OUT, `C00-Login-${width}.png`), fullPage: true, caret: "initial" });
  }
});

test("F02_C01_C14_C20_C21_as_founder", async ({ page }) => {
  await loginToConsole(page, FOUNDER_EMAIL);
  for (const [file, url] of SCREENS) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.screenshot({ path: path.join(OUT, `${file}-${width}.png`), fullPage: true, caret: "initial" });
    }
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
