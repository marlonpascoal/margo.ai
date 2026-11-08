// B01 owner journey in the portal (P19 to P24 / W10 to W15), on synthetic data: the Dono of Grupo Exemplo (G-SYN) starts
// monitoring an own store, waits while the captures arrive (an extractor stand-in answers with the SINTÉTICO menus of
// fixtures/m1/portal/menus.json through the /api/extract functions; workers run as `uv run worker <type> --local --once`),
// reviews the doubts in bulk, reads the result, the history after a second run and downloads the PDF, which
// worker-render prints from the result page with Playwright. A02/A03 per role: Financeiro sees and cannot act, the
// Gerente do Centro sees and answers only the Cozinha Centro monitoring, another account sees nothing. Screenshots at
// 375 px and 1280 px go to apps/web/test-results/raio-x/ (no drawing yet; build-review 07/nov).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DONO_EMAIL, PANTANOS_EMAIL, ROOT, adminDb, portalSession, runWorker, sid, withLoginEmail } from "./helpers";

const tag = randomBytes(4).toString("hex");
const G02 = sid("G-02");
const DONO = sid("p:g02-dono");
const FIN_EMAIL = "financeiro@exemplo.com.br";
const GERENTE_EMAIL = `gerente.raio-x.${tag}@exemplo.com.br`;
const OWN_STORE = "Burger do Bairro Centro";
const OWN_EXT = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ZS_EXT = "c47e0a19-2b6d-4f8e-a135-9c0d7e2f450d";
const SHOTS = path.join(ROOT, "apps/web/test-results/raio-x");

type Item = { external_item_id: string; name: string; taxonomy_level2: string; price_cents: number; unit: string };
const MENUS = JSON.parse(readFileSync(path.join(ROOT, "fixtures/m1/portal/menus.json"), "utf8")) as { target: Item[]; neighbors: { name: string; distance_m: number; items: Item[] }[] };
const neighborExt = (n: number) => `${tag}-0000-4000-8000-${String(n).padStart(12, "0")}`;

let monitorId = "";
let zonaSulMonitor = "";
let undoGerente: (() => Promise<void>) | null = null;

async function shots(page: Page, name: string) {
  for (const [w, h] of [
    [375, 812],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`), fullPage: true });
  }
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await adminDb().rpc(fn as never, args as never);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** The discovery stand-in: the neighbors of the fixture become the run's store set, their captures and the target's queued. */
async function neighborhood(xrayId: string) {
  const db = adminDb();
  await db.from("job").delete().eq("type", "extract_discover").eq("payload->>xray_id", xrayId);
  // A discovery reports the target's public name and area too.
  await db.from("public_store").update({ name: OWN_STORE, area: "Centro" }).eq("channel", "ifood").eq("external_id", OWN_EXT);
  for (const [i, n] of MENUS.neighbors.entries()) {
    const ext = neighborExt(i + 1);
    const { data: s, error } = await db
      .from("public_store")
      .insert({ channel: "ifood", external_id: ext, name: n.name, area: "Bairro Sintético", url: `https://www.ifood.com.br/delivery/cidade-sintetica-sp/vizinha-${i + 1}/${ext}` })
      .select("id")
      .single();
    if (error) throw error;
    await db.from("xray_store").insert({ xray_id: xrayId, public_store_id: s!.id, distance_m: n.distance_m, included: true, capture_slot: true, capture_rank: i + 1 });
  }
  await db.from("xray").update({ collected_at: new Date().toISOString() }).eq("id", xrayId);
  await rpc("extract_queue_xray_captures", { p_xray: xrayId, p_env: "sandbox" });
}

/** The extractor stand-in: answers up to n queued captures with the fixture menus. */
async function capture(n: number) {
  for (let k = 0; k < n; k++) {
    const jobs = await rpc<{ job_id: string; kind: string; payload: { url: string } }[]>("extract_claim_next", { p_worker: `e2e-${tag}`, p_env: "sandbox" });
    const job = jobs?.[0];
    if (!job) return;
    const ext = job.payload.url.split("/").at(-1)!;
    const i = Array.from({ length: MENUS.neighbors.length }, (_, j) => neighborExt(j + 1)).indexOf(ext);
    const items = ext === OWN_EXT ? MENUS.target : i >= 0 ? MENUS.neighbors[i].items : [];
    await rpc("extract_record_result", {
      p_job: job.job_id,
      p_source: "scraper",
      p_collected_at: new Date().toISOString(),
      p_copies: [{ external_id: ext, content: { kind: "capture", store: { external_id: ext, name: ext === OWN_EXT ? OWN_STORE : MENUS.neighbors[i]?.name, area: "Centro" }, items } }],
    });
  }
}

async function runStatus(xrayId: string) {
  const { data } = await adminDb().from("xray").select("status").eq("id", xrayId).single();
  return data!.status as string;
}

async function lastXray(): Promise<string> {
  const { data } = await adminDb().from("xray_monitor").select("last_xray_id").eq("id", monitorId).single();
  return data!.last_xray_id as string;
}

/** Runs queued jobs of a type until none is left for this run. */
async function drain(type: string, xrayId: string) {
  for (let k = 0; k < 4; k++) {
    const { count } = await adminDb().from("job").select("id", { count: "exact", head: true }).eq("type", type).eq("status", "queued").eq("payload->>xray_id", xrayId);
    if (!count) return;
    runWorker(type);
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = adminDb();
  await db.from("job").delete().in("type", ["extract_discover", "extract_capture"]).eq("status", "queued");
  // A rerun after a failure: a capture of the own store claimed and never answered would hold its place.
  await db.from("job").delete().eq("type", "extract_capture").eq("status", "running").eq("payload->>external_id", OWN_EXT);
  undoGerente = await withLoginEmail(sid("p:g02-ger"), GERENTE_EMAIL);
});

test.afterAll(async () => {
  const db = adminDb();
  const { data: mons } = await db.from("xray_monitor").select("id").eq("account_id", G02);
  for (const mon of mons ?? []) {
    const { data: xs } = await db.from("xray").select("id").eq("monitor_id", mon.id);
    for (const x of xs ?? []) {
      const { data: prints } = await db.from("xray_print").select("path").eq("xray_id", x.id);
      if (prints?.length) await db.storage.from("pdf").remove(prints.map((p) => p.path));
      await db.from("job").delete().eq("payload->>xray_id", x.id);
    }
    await db.from("xray_monitor").update({ last_xray_id: null }).eq("id", mon.id);
    await db.from("xray").delete().eq("monitor_id", mon.id);
    await db.from("xray_monitor").delete().eq("id", mon.id);
  }
  await db.from("job").delete().in("type", ["extract_discover", "extract_capture"]).eq("status", "queued");
  await undoGerente?.();
});

test("B01_P19_P20_P21_dono_starts_monitoring_an_own_store_and_waits", async ({ page }) => {
  await portalSession(page, DONO_EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });

  await test.step("P19: the menu has Raio-X; empty list offers to start", async () => {
    await page.goto("/app/raio-x");
    await expect(page.getByRole("navigation", { name: "Portal do dono" }).getByRole("link", { name: "Raio-X" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Raio-X de preço" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Você ainda não acompanha nenhuma loja." })).toBeVisible();
    await shots(page, "P19-W10-vazio");
  });

  await test.step("P20: an own store, weekly, 3 km; the plan line and limits come from the server", async () => {
    await page.goto("/app/raio-x/novo");
    await expect(page.getByRole("heading", { name: "Acompanhar uma loja" })).toBeVisible();
    await page.getByLabel("Sua loja").selectOption({ label: `${OWN_STORE} · iFood` });
    await expect(page.getByLabel("Com que frequência?")).toHaveValue("7");
    await expect(page.getByText("Suas lojas estão incluídas no plano Lucro.")).toBeVisible();
    await page.getByText("Um concorrente").click();
    await page.getByRole("textbox", { name: "Link da loja no iFood" }).fill("https://www.rappi.com.br/loja/123");
    await expect(page.locator("#url-help [role=alert]")).toHaveText("Este link não é de uma loja do iFood. Abra a loja no iFood e copie o endereço.");
    await expect(page.getByRole("button", { name: "Começar a acompanhar" })).toBeDisabled();
    await shots(page, "P20-W11-concorrente");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByText("Uma loja minha").click();
    await shots(page, "P20-W11");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Começar a acompanhar" }).click();
    await page.waitForURL(/\/app\/raio-x\/[0-9a-f-]{36}\/lendo$/);
    monitorId = page.url().split("/").at(-2)!;
    const { data: audit } = await adminDb().from("audit_log").select("actor_person_id").eq("action", "monitor.create").eq("entity_id", monitorId);
    expect(audit).toEqual([{ actor_person_id: DONO }]);
  });

  await test.step("P21: discovery first, with the usual range", async () => {
    await expect(page.getByRole("heading", { name: "Lendo os cardápios" })).toBeVisible();
    await expect(page.locator(".step.now")).toContainText("Buscar a vizinhança");
    await expect(page.getByText("Costuma levar de 30 minutos a 2 horas.")).toBeVisible();
    await expect(page.getByText("Pode fechar esta página.")).toBeVisible();
  });

  await test.step("P21: captures arrive; counts, range, partial view by category; polls the progress API", async () => {
    const xrayId = await lastXray();
    await neighborhood(xrayId);
    await capture(4);
    await page.reload();
    await expect(page.locator(".step.now")).toContainText("Ler os cardápios");
    await expect(page.getByTestId("lidos")).toHaveText(/^[4-6] de 7$/);
    await expect(page.getByTestId("eta")).toHaveText(/^cerca de \d+/);
    await expect(page.getByText("parcial, ainda sem comparação")).toBeVisible();
    await expect(page.getByText("Cardápios já lidos")).toBeVisible();
    await page.getByText("Por que demora?").click();
    await expect(page.getByText("Comparamos cada item seu com os delas: mesmo produto, mesmo tamanho, mesmo sabor.")).toBeVisible();
    await expect(page.getByText(/Até agora: \d+ cardápios, \d+ itens\./)).toBeVisible();
    const polled = await page.waitForRequest((r) => r.url().includes(`/api/raio-x/${monitorId}/progress`), { timeout: 25_000 });
    expect(polled.method()).toBe("GET");
    await shots(page, "P21-W12");
  });

  await test.step("P21 to P22: the rest is read, pairing and calculation run by themselves; the page opens the doubts", async () => {
    const xrayId = await lastXray();
    await capture(10);
    expect(await runStatus(xrayId)).toBe("pairing");
    await drain("xray_pair", xrayId);
    await drain("xray_calc", xrayId);
    expect(await runStatus(xrayId)).toBe("ready");
    await page.goto(`/app/raio-x/${monitorId}/lendo`);
    await page.waitForURL(new RegExp(`/app/raio-x/${monitorId}(/revisar)?$`));
  });
});

test("B01_P22_dono_reviews_in_bulk_answers_undoes_and_confirms_all", async ({ page }) => {
  await portalSession(page, DONO_EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });
  const xrayId = await lastXray();
  const doubts = await rpc<{ open: number; items: { item_id: string; name: string; group: string }[] }>("monitor_doubts", { p_xray: xrayId });
  test.skip(doubts.open < 2, `the fixture should leave at least 2 doubts, got ${doubts.open}`);

  await page.goto(`/app/raio-x/${monitorId}/revisar`);
  await expect(page.getByRole("heading", { name: "Itens em dúvida" })).toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(`Ficou em dúvida em ${doubts.open}\\.`) })).toBeVisible();
  await expect(page.locator(".catgh").first()).toBeVisible();
  await expect(page.getByText("É o mesmo produto que o seu?").first()).toBeVisible();
  await shots(page, "P22-W13");
  await page.setViewportSize({ width: 1280, height: 900 });

  const [a, b] = doubts.items;
  await page.getByLabel(`Selecionar ${a.name}`).check();
  await page.getByLabel(`Selecionar ${b.name}`).check();
  const bar = page.getByRole("region", { name: "Ações nos selecionados" });
  await expect(bar).toContainText("2 itens selecionados");
  await shots(page, "P22-W13-selecao");
  await page.setViewportSize({ width: 1280, height: 900 });
  await bar.getByRole("button", { name: "Confirmar sugestões dos selecionados" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 confirmados." })).toBeVisible();
  await expect(page.locator(`[data-item="${a.name}"]`).getByRole("button", { name: "Desfazer" })).toBeVisible();
  const { data: answered } = await adminDb().from("audit_log").select("entity_id").eq("action", "monitor.answer").eq("actor_person_id", DONO).in("entity_id", [a.item_id, b.item_id]);
  expect(answered).toHaveLength(2);

  await page.locator(`[data-item="${a.name}"]`).getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Resposta desfeita" })).toBeVisible();
  await drain("xray_pair", xrayId);
  await drain("xray_calc", xrayId);
  await page.reload();
  await page.getByRole("button", { name: /^Confirmar todas as sugestões \(\d+\)$/ }).first().click();
  await expect(page.getByText("Seu raio-X foi atualizado com as suas respostas.")).toBeVisible();
  await drain("xray_calc", xrayId);
  expect((await rpc<{ open: number }>("monitor_doubts", { p_xray: xrayId })).open).toBe(0);
  const only = page.locator("summary", { hasText: "Itens só seus" });
  if (await only.count()) {
    await only.click();
    await expect(page.getByText("Ninguém por perto vende algo igual. Nada a fazer.")).toBeVisible();
  }
});

test("B01_P23_result_is_the_delivery_money_free_with_position_categories_and_store_lists", async ({ page }) => {
  await portalSession(page, DONO_EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/app/raio-x/${monitorId}`);
  await expect(page.getByRole("heading", { name: "Raio-X de preço", exact: true })).toBeVisible();
  await expect(page.getByText("Como ler este raio-X").first()).toBeVisible();
  await expect(page.getByText("Score de preço", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Você cobra menos que \d+ das \d+ lojas vizinhas/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Por categoria" })).toBeVisible();
  await expect(page.locator(".catc[open]").first()).toBeVisible();
  await expect(page.locator(".catc[open]").getByText("Espaço para subir", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/de diferença por venda/).first()).toBeVisible();
  await expect(page.getByText("Como calculamos.")).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text, "money-free: never margin or gain").not.toMatch(/margem|ganho/i);
  expect(text.match(/lucro/gi), "profit only in \"é diferença de preço, não lucro\"").toHaveLength(1);
  expect(text).toContain("É diferença de preço, não lucro");
  expect(text).not.toContain("—");
  await page.locator(".catc[open] .lojas summary").first().click();
  await expect(page.locator(".catc[open] .sl .me-row").first()).toContainText("Você");
  await page.getByRole("button", { name: "Compartilhar" }).click();
  await expect(page.getByRole("button", { name: /Baixar PDF/ })).toBeVisible();
  await expect(page.getByText("Copiar link")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await shots(page, "P23-W14");
});

test("B01_P24_history_after_a_second_run_three_levels_with_tables", async ({ page }) => {
  const first = await lastXray();
  await adminDb().from("xray_monitor").update({ next_run_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", monitorId);
  expect(await rpc<number>("monitor_queue_due", { p_env: "sandbox" })).toBeGreaterThanOrEqual(1);
  const second = await lastXray();
  expect(second).not.toBe(first);
  if ((await runStatus(second)) === "collecting") await capture(10);
  await drain("xray_pair", second);
  await drain("xray_calc", second);
  expect(await runStatus(second)).toBe("ready");

  await portalSession(page, DONO_EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/app/raio-x/${monitorId}/historico`);
  await expect(page.getByRole("heading", { name: "Histórico" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "O restaurante" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Por categoria" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Um produto" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Posição de preço por raio-X" })).toBeVisible();
  await shots(page, "P24-W15");
  await page.setViewportSize({ width: 1280, height: 900 });
  const rest = page.locator("section", { has: page.getByRole("heading", { name: "O restaurante" }) });
  await rest.getByRole("button", { name: "Ver como tabela" }).click();
  await expect(rest.getByRole("table")).toContainText("Posição");
  const chips = page.getByRole("group", { name: "Escolher categoria" }).getByRole("link");
  if ((await chips.count()) > 1) {
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute("aria-current", "true");
  }
  await page.getByRole("combobox", { name: "Item" }).selectOption({ index: 1 });
  await page.waitForURL(/item=/);
  await expect(page.getByRole("img", { name: /^Preço de .+ por raio-X$/ })).toBeVisible();

  // P19 now shows position and score on the row.
  await page.goto("/app/raio-x");
  const row = page.locator(`[data-monitor="${monitorId}"]`);
  await expect(row).toContainText(/\dª mais barata de \d+/);
  await expect(row).toContainText("Score de preço");
  await shots(page, "P19-W10");
});

test("B01_P23_baixar_pdf_prints_the_result_page_once_per_version", async ({ page, baseURL }) => {
  await portalSession(page, DONO_EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });
  const xrayId = await lastXray();
  const since = new Date().toISOString();

  // The print page needs worker-render's token.
  expect((await page.request.get(`/imprimir/raio-x/${xrayId}`)).status()).toBe(404);
  expect((await page.request.get(`/imprimir/raio-x/${xrayId}?t=${"x".repeat(43)}`)).status()).toBe(404);

  await page.goto(`/app/raio-x/${monitorId}`);
  await page.getByRole("button", { name: "Compartilhar" }).click();
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: /Baixar PDF/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Preparando o PDF" })).toBeVisible();
  await expect.poll(async () => (await adminDb().from("job").select("id").eq("type", "render_xray").eq("payload->>xray_id", xrayId).eq("status", "queued")).data?.length ?? 0).toBe(1);
  execFileSync("node", ["scripts/with-local-env.mjs", "uv", "run", "worker", "render_xray", "--local", "--once"], { cwd: ROOT, stdio: "pipe", timeout: 180_000, env: { ...process.env, MARGO_APP_URL: baseURL! } });
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^raio-x-burger-do-bairro-centro-\d{4}-\d{2}-\d{2}\.pdf$/);
  const bytes = readFileSync((await file.path())!);
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  await file.saveAs(path.join(SHOTS, "P23-W14-impresso.pdf"));
  expect(bytes.toString("latin1")).toMatch(/\/Type\s*\/Page\b/);

  const { data: prints } = await adminDb().from("xray_print").select("version, pages").eq("xray_id", xrayId);
  expect(prints).toHaveLength(1);
  const { data: audit } = await adminDb().from("audit_log").select("actor_person_id").eq("action", "xray.print_request").eq("entity_id", xrayId).gte("at", since);
  expect(audit).toEqual([{ actor_person_id: DONO }]);

  // Same version: served from the cache, no new job.
  const res = await page.request.post(`/api/raio-x/${monitorId}/pdf?raio-x=${xrayId}`);
  expect(await res.json()).toEqual({ state: "ready" });
  const { count } = await adminDb().from("job").select("id", { count: "exact", head: true }).eq("type", "render_xray").eq("payload->>xray_id", xrayId).eq("status", "queued");
  expect(count).toBe(0);
});

test("A03_B01_financeiro_sees_the_journey_and_cannot_act", async ({ page }) => {
  await portalSession(page, FIN_EMAIL);
  await page.goto("/app/raio-x");
  await expect(page.locator(`[data-monitor="${monitorId}"]`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Acompanhar uma loja" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Mais ações/ })).toHaveCount(0);
  expect((await page.goto("/app/raio-x/novo"))!.status()).toBe(404);
  await page.goto(`/app/raio-x/${monitorId}/revisar`);
  await expect(page.getByText("Só o Dono e o Gerente da cozinha respondem. Você pode ver as dúvidas.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Confirmar todas as sugestões/ })).toHaveCount(0);
  expect((await page.goto(`/app/raio-x/${monitorId}`))!.status()).toBe(200);
});

test("A03_B01_gerente_do_centro_sees_and_answers_only_cozinha_centro", async ({ page }) => {
  // A monitoring of the Zona Sul store (Cozinha Zona Sul), created on the server for the Dono.
  const out = await rpc<{ monitor_id: string }>("monitor_create", {
    p_account: G02,
    p_external_id: ZS_EXT,
    p_url: `https://www.ifood.com.br/delivery/sao-paulo-sp/zona-sul-burger-do-bairro/${ZS_EXT}`,
    p_kitchen: null,
    p_every_days: 7,
    p_radius_km: 3,
    p_categories: ["Lanches"],
    p_rules: {},
    p_actor: DONO,
    p_env: "sandbox",
  });
  zonaSulMonitor = out.monitor_id;

  await portalSession(page, GERENTE_EMAIL);
  await page.goto("/app/raio-x");
  await expect(page.locator(`[data-monitor="${monitorId}"]`)).toBeVisible();
  await expect(page.locator(`[data-monitor="${zonaSulMonitor}"]`)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Acompanhar uma loja" })).toHaveCount(0);
  for (const url of [`/app/raio-x/${zonaSulMonitor}`, `/app/raio-x/${zonaSulMonitor}/lendo`, `/app/raio-x/${zonaSulMonitor}/historico`, "/app/raio-x/novo"]) {
    expect((await page.goto(url))!.status(), url).toBe(404);
  }
  expect((await page.request.get(`/api/raio-x/${zonaSulMonitor}/progress`)).status()).toBe(404);
  expect((await page.request.post(`/api/raio-x/${zonaSulMonitor}/pdf`)).status()).toBe(404);
  await page.goto(`/app/raio-x/${monitorId}/revisar`);
  await expect(page.getByText("Só o Dono e o Gerente da cozinha respondem.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Desfazer" }).first()).toBeVisible();
});

test("A02_B01_another_account_sees_nothing_of_grupo_exemplo", async ({ page }) => {
  await portalSession(page, PANTANOS_EMAIL);
  for (const url of [`/app/raio-x/${monitorId}`, `/app/raio-x/${monitorId}/revisar`, `/app/raio-x/${monitorId}/historico`]) {
    expect((await page.goto(url))!.status(), url).toBe(404);
  }
  expect((await page.request.get(`/api/raio-x/${monitorId}/progress`)).status()).toBe(404);
  expect((await page.request.get(`/api/raio-x/${monitorId}/pdf`)).status()).toBe(404);
});
