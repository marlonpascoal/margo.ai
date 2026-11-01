// Module 3 on the G-SYN seed (07: D03; 05: C12, C13, P08/W01). worker-cost runs as a plain process
// (`uv run worker compute_contribution --local --once`), as in local development (02 §3).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminDb, DONO_EMAIL, FOUNDER_EMAIL, loginToConsole, loginToPortal, runWorker, sid } from "./helpers";

test.describe.configure({ mode: "serial" });

const G02 = sid("G-02");
const MINUS = "−";
let context: BrowserContext;
let page: Page;

/** The seed's prices date: recompute as of it so the account is left exactly as seeded. */
async function recomputeAsSeeded() {
  await adminDb().from("job").insert({ type: "compute_contribution", payload: { account_id: G02, as_of: "2026-10-30" }, account_id: G02 });
  runWorker("compute_contribution");
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  page = await context.newPage();
  await loginToConsole(page, FOUNDER_EMAIL);
});

test.afterAll(async () => {
  await context.close();
});

test("D03_C13_rows_decision_and_error_note_by_CTB01", async () => {
  await page.goto("/console/contas/G-02/contribuicao/2026-09");
  await expect(page.getByText("C13 · Módulo 3 · Grupo Exemplo · set/2026")).toBeVisible();
  await expect(page.locator("[data-decision]")).toHaveText("O cupom de 20% no Combo casal derruba a contribuição de R$ 35,96 para R$ 28,48 por pedido no iFood.");
  // CTB-01 as 04 §4 writes it (commission, payment fee, store share of the co-funded coupon); differs from the drawing.
  const drawn: [string, string[]][] = [
    ["X-Bacon artesanal · iFood", ["36,90", `${MINUS}5,61`, `${MINUS}12,44`, "18,85", "51%"]],
    ["X-Bacon artesanal · 99Food", ["36,90", `${MINUS}4,50`, `${MINUS}12,44`, "19,96", "54%"]],
    ["Combo casal · iFood", ["79,90", `${MINUS}12,14`, `${MINUS}31,80`, "35,96", "45%"]],
    ["Combo casal, cupom 20% · iFood", ["79,90", `${MINUS}19,62`, `${MINUS}31,80`, "28,48", "36%"]],
    ["Batata frita média · iFood", ["14,90", `${MINUS}2,26`, `${MINUS}3,10`, "9,54", "64%"]],
    ["Refrigerante lata · iFood", ["5,00", `${MINUS}0,76`, `${MINUS}2,85`, "1,39", "28%"]],
  ];
  for (const [key, cells] of drawn) {
    const row = page.locator(`tr[data-row="${key}"]`);
    await expect(row.locator("td").nth(2)).toHaveText(cells[0]);
    await expect(row.locator("td").nth(3)).toHaveText(cells[1]);
    await expect(row.locator("td").nth(4)).toHaveText(cells[2]);
    await expect(row.locator("td").nth(5)).toHaveText(cells[3]);
    await expect(row.locator("td").nth(6)).toHaveText(cells[4]);
  }
  // CTB-02: no row can invert, as drawn.
  await expect(page.locator("tr[data-invert]")).toHaveCount(0);
  await expect(page.getByText("Custo com barra de erro de ± 9% (ver ficha técnica). Um erro desse tamanho não inverte nenhuma linha.")).toBeVisible();
  await expect(page.getByText("Aprovação de cupom (depois)")).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("link", { name: "ver ficha técnica" }).click();
  await page.waitForURL("**/console/contas/G-02/fichas");
});

test("C12_xbacon_ficha_and_done_when_a_regional_prior_widens_the_error_bar", async () => {
  await page.goto("/console/contas/G-02/fichas");
  await expect(page.getByText("C12 · Módulo 3 · Grupo Exemplo · 8 de 20 fichas prontas")).toBeVisible();
  await expect(page.locator("[data-cost]")).toHaveText("custo R$ 12,44 ± 9%");
  const lines: [string, string[]][] = [
    ["Carne bovina moída (blend)", ["160 g", "85%", "nota de 12/out", "R$ 7,32"]],
    ["Queijo cheddar fatiado", ["28 g", "100%", "nota de 30/set", "R$ 1,46"]],
    ["Bacon em cubos", ["30 g", "100%", "estimativa regional", "R$ 1,38"]],
    ["Pão brioche", ["1 un", "100%", "nota de 05/out", "R$ 1,15"]],
    ["Maionese (base de molho)", ["20 g", "100%", "nota de 18/set", "R$ 0,23"]],
    ["Embalagem kraft", ["1 un", "100%", "estimativa regional", "R$ 0,90"]],
  ];
  for (const [name, cells] of lines) {
    const row = page.locator(`tr[data-line="${name}"]`);
    for (let i = 0; i < cells.length; i++) await expect(row.locator("td").nth(i + 1)).toHaveText(cells[i]);
  }
  await expect(page.getByText("A barra de erro vem do rendimento declarado e dos dois preços que ainda são estimativa regional.")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Itens do cardápio" });
  await expect(nav.getByRole("link", { name: /Cheddar burger/ })).toContainText("a fazer");
  // A dish fully from notes (Batata frita média) has a narrower bar than X-Bacon with two regional prices.
  await nav.getByRole("link", { name: /Batata frita média/ }).click();
  await expect(page.locator("[data-cost]")).toHaveText("custo R$ 3,10 ± 2%");
  await expect(page.getByText("A barra de erro vem do rendimento medido. Todos os preços são de nota.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver contribuição" })).toHaveAttribute("href", "/console/contas/G-02/contribuicao/2026-09");
});

test("A04_C12_edit_a_yield_is_audited_and_worker_cost_recomputes_c12_and_c13", async () => {
  const lineId = sid("G-02:recipe:smash:1");
  const since = new Date().toISOString();
  await page.goto(`/console/contas/G-02/fichas?prato=${sid("G-02:dish:smash")}`);
  await expect(page.locator("[data-cost]")).toHaveText("custo R$ 12,03 ± 6%");
  await page.getByRole("link", { name: "Editar ficha" }).click();
  await page.getByLabel("Rendimento, Carne bovina moída (blend)").fill("80");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator("[data-cost]")).toHaveText("custo recalculando");
  try {
    const { data: audit } = await adminDb().from("audit_log").select("action, after").eq("entity_id", lineId).gte("at", since);
    expect(audit).toEqual([{ action: "recipe_line.update", after: { qty_base_units: 180, yield_pct: 0.8, yield_confidence: "declarado" } }]);
    runWorker("compute_contribution");
    await page.reload();
    // CST-03: 180 g / 80% of blend instead of 85%, so the cost goes up.
    await expect(page.locator("[data-cost]")).not.toHaveText(/recalculando|12,03/);
    await expect(page.locator('tr[data-line="Carne bovina moída (blend)"] td').nth(2)).toHaveText("80%");
  } finally {
    await adminDb().from("recipe_line").update({ yield_pct: 0.85 }).eq("id", lineId);
    await recomputeAsSeeded();
  }
  await page.reload();
  await expect(page.locator("[data-cost]")).toHaveText("custo R$ 12,03 ± 6%");
});

test("C08_the_m3_prompt_goes_away_once_the_close_has_contribution", async () => {
  await page.goto("/console/contas/G-02/fechamento/2026-09");
  await expect(page.getByRole("heading", { name: "Fechamento de setembro, por canal" })).toBeVisible();
  await expect(page.getByText("Ainda falta o custo dos insumos para chegar ao lucro por item.")).toHaveCount(0);
});

test("W01_kpis_equal_C08_and_C13_and_the_decision_for_october", async ({ browser }) => {
  const db = adminDb();
  const close = sid("G-02:close:2026-09");
  const { data: lines } = await db.from("close_line").select("gross_cents, payout_cents").eq("close_period_id", close);
  const { data: rows } = await db.from("contribution").select("units, ingredient_cents, packaging_cents").eq("close_period_id", close);
  const sold = lines!.reduce((a, l) => a + l.gross_cents, 0);
  const left = lines!.reduce((a, l) => a + l.payout_cents, 0) - rows!.reduce((a, r) => a + r.units * (r.ingredient_cents + r.packaging_cents), 0);
  const brl = (c: number) => `R$ ${String(Math.round(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const owner = await ctx.newPage();
  await owner.setViewportSize({ width: 1280, height: 900 });
  await loginToPortal(owner, DONO_EMAIL);
  await owner.goto("/app");
  const main = owner.locator("main:visible");
  await expect(main.getByText(brl(sold), { exact: true })).toBeVisible();
  await expect(main.getByText(brl(left), { exact: true })).toBeVisible();
  await expect(main.getByText(`sobrou depois dos insumos (${Math.round((left * 100) / sold)}%)`)).toBeVisible();
  await expect(main.locator("[data-decision]")).toHaveText("Uma decisão para outubro. O cupom de 20% no Combo casal deixa R$ 28,48 por pedido, contra R$ 35,96 sem cupom.");
  await expect(main.getByText("falta custo")).toHaveCount(0);
  await ctx.close();
});
