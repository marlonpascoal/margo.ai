// Module 3 intake (07: D01, D02; 05 C10, C11, P05). Local stack with the G-SYN seed; worker-import runs as a
// plain process (`uv run worker import_invoice_zip --local --once`). worker-match's AI step never runs here:
// no test calls the Claude API (06, D40); C11 works on the suggestions the seed holds.
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { FOUNDER_EMAIL, ROOT, adminDb, loginToConsole, runWorker } from "./helpers";

const ZIP = path.join(ROOT, "fixtures", "m3", "notas-pantanos-nov2025-out2026-SINTETICO.zip");

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let g01 = "";
const imports: string[] = [];
const keyed: string[] = [];

/** A valid key of a synthetic NFC-e (issuer CNPJ with invalid check digits), check digit computed here. */
function syntheticKey(): string {
  const first = `4126101234567800019065001${String(Date.now() % 1e9).padStart(9, "0")}112345678`;
  let total = 0;
  let w = 2;
  for (let i = first.length - 1; i >= 0; i--) {
    total += Number(first[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = total % 11;
  return first + (r < 2 ? 0 : 11 - r);
}

test.beforeAll(async ({ browser }) => {
  g01 = (await adminDb().from("account").select("id").eq("code", "G-01").single()).data!.id;
  context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  page = await context.newPage();
  await loginToConsole(page, FOUNDER_EMAIL);
});

// Leave G-SYN as seeded: G-01's imported invoices, runs, keyed receipts and queued match job gone.
test.afterAll(async () => {
  const db = adminDb();
  if (imports.length) {
    await db.from("invoice").delete().in("invoice_import_id", imports);
    await db.from("invoice_import").delete().in("id", imports);
  }
  if (keyed.length) await db.from("invoice").delete().in("id", keyed);
  await db.from("job").delete().eq("account_id", g01).in("type", ["match_ai", "import_invoice_zip"]).in("status", ["queued", "failed"]);
  await context?.close();
});

test("D01_C10_accountant_zip_imports_with_the_drawn_counts", async () => {
  const since = new Date().toISOString();
  await page.goto("/console/contas/G-01/notas");
  await expect(page.getByRole("heading", { name: "Notas de compra" })).toBeVisible();
  await page.getByLabel("Arraste o .zip com os XMLs de compra").setInputFiles(ZIP);
  await page.getByRole("button", { name: "Importar" }).click();
  let id: string | undefined;
  await expect
    .poll(async () => {
      const { data } = await adminDb().from("invoice_import").select("id").eq("account_id", g01).gt("created_at", since).limit(1);
      id = data?.[0]?.id;
      return id;
    })
    .toBeTruthy();
  imports.push(id!);
  for (let i = 0; i < 5; i++) {
    runWorker("import_invoice_zip");
    const { data } = await adminDb().from("invoice_import").select("status").eq("id", id!).single();
    if (data && !["queued", "running"].includes(data.status)) break;
  }
  await page.reload();
  await expect(page.locator("[data-zip-stats]")).toHaveText("312 notas · 12 meses · 41 fornecedores" + "NF-e: 268 · NFC-e: 44 · duplicadas: 9");
  const { count } = await adminDb().from("invoice").select("id", { count: "exact", head: true }).eq("invoice_import_id", id!);
  expect(count).toBe(312);
  const { data: audit } = await adminDb().from("audit_log").select("action").eq("entity_id", id!);
  expect(audit?.map((a) => a.action)).toEqual(["invoice_import.upload"]);
});

test("D01_C10_invalid_key_rejected_before_saving_and_a_valid_one_saved", async () => {
  const key = syntheticKey();
  const bad = key.slice(0, 43) + ((Number(key[43]) + 1) % 10);
  await page.goto("/console/contas/G-01/notas");
  await page.getByLabel("Chave de 44 dígitos ou link do QR code").fill(bad);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toHaveText("Chave inválida: confira os 44 dígitos ou o link do QR code.");
  expect((await adminDb().from("invoice").select("id").eq("access_key", bad)).data).toEqual([]);

  await page.getByLabel("Chave de 44 dígitos ou link do QR code").fill(`https://www.fazenda.pr.gov.br/nfce/qrcode?p=${key}|2|1|1|ABC`);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator(`[data-receipt="${key}"]`)).toBeVisible();
  const { data: inv } = await adminDb().from("invoice").select("id, source, model").eq("access_key", key).single();
  keyed.push(inv!.id);
  expect([inv!.source, inv!.model]).toEqual(["qr_url", 65]);

  // A line typed from the state's public page.
  const receipt = page.locator(`[data-receipt="${key}"]`);
  await receipt.getByLabel("Data da nota").fill("2026-10-20");
  await receipt.getByLabel("Descrição do item").fill("BACON CUBOS CONG KG");
  await receipt.getByLabel("Unidade").fill("KG");
  await receipt.getByLabel("Quantidade").fill("2");
  await receipt.getByLabel("Valor do item").fill("92,00");
  await receipt.getByRole("button", { name: "Adicionar item" }).click();
  await expect(page.locator(`[data-receipt="${key}"]`)).toContainText("R$ 92,00");
  const { data: lines } = await adminDb().from("invoice_line").select("description, qty, total_cents, unit_price_cents").eq("invoice_id", inv!.id);
  expect(lines).toEqual([{ description: "BACON CUBOS CONG KG", qty: 2, total_cents: 9200, unit_price_cents: 4600 }]);
});
