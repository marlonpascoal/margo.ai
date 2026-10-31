// F02: each built console page at 390 px and 1280 px, saved next to the drawing's name for Marlon to compare.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { ARTIFACTS, DONO_EMAIL, FOUNDER_EMAIL, PANTANOS_EMAIL, adminDb, loginToConsole, loginToPortal, runWorker, sid } from "./helpers";

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

// Owner portal (05 §B, D32): one responsive route per P/W pair. The 390 px shot goes next to the phone
// drawing (P..) and the 1280 px shot next to the computer drawing (W..); single drawings get both widths.
type PortalShot = [url: string, phone: string, computer: string];
const PUBLIC_PORTAL: PortalShot[] = [
  ["/entrar", "P15-Entrar", "W06-Entrar"],
  ["/criar-conta", "P07-CriarConta", "P07-CriarConta"],
  ["/nao-consigo-entrar", "P17-Recuperar", "P17-Recuperar"],
  // Seed invite for the Contador (G-02), valid until 05/nov.
  ["/convite/g-syn-convite-contador", "P18-Convite", "P18-Convite"],
  ["/termos", "P11-Termos", "P11-Termos"],
];
const OWNER_PORTAL: PortalShot[] = [
  ["/app", "P08-MinhaConta", "W01-Inicio"],
  ["/app/notificacoes", "P16-Notificacoes", "W08-Notificacoes"],
  ["/app/seguranca", "W09-Seguranca", "W09-Seguranca"],
];

async function shootPortal(page: import("@playwright/test").Page, shots: PortalShot[], suffix = "") {
  for (const [url, phone, computer] of shots) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.screenshot({ path: path.join(OUT, `${width === 390 ? phone : computer}${suffix}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
}

test("F02_P07_P11_P15_P17_P18_W06_public", async ({ page }) => {
  await shootPortal(page, PUBLIC_PORTAL);
});

test("F02_P08_P16_W01_W08_W09_as_dono_of_grupo_exemplo", async ({ page }) => {
  await loginToPortal(page, DONO_EMAIL);
  await shootPortal(page, OWNER_PORTAL);
});

// P08 is drawn for Pantanos Burguer in its trial.
test("F02_P08_as_dono_of_pantanos_in_trial", async ({ page }) => {
  await loginToPortal(page, PANTANOS_EMAIL);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/app");
  await page.screenshot({ path: path.join(OUT, "P08-MinhaConta-Pantanos-390.png"), fullPage: true, caret: "initial" });
});
