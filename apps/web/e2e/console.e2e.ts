// Console acceptance flows on the local stack: E03 (C00 login), C00/C14 role rule, C14 and A06.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_FAKE_SECRETS } from "./fake-secrets";
import { ARTIFACTS, ROOT, FOUNDER_EMAIL, adminDb, clearMail, createStaff, loginToConsole, mailCode } from "./helpers";

const tag = randomBytes(4).toString("hex");
const RESPONSES = path.join(ARTIFACTS, "e2e", "responses");

test.describe.configure({ mode: "serial" });

test("E03_console_without_session_goes_to_C00", async ({ page }) => {
  await page.goto("/console");
  await page.waitForURL("**/console/login");
  await expect(page.getByRole("heading", { name: "Entrar no console" })).toBeVisible();
  const res = await page.goto("/console/config");
  expect(page.url()).toMatch(/\/console\/login$/);
  expect(res?.status()).toBe(200);
});

test("E03_C00_non_invited_email_gets_the_same_message_and_no_code", async ({ page }) => {
  const stranger = `e2e-nao-convidado-${tag}@teste.local`;
  await clearMail(stranger);
  await page.goto("/console/login");
  await page.getByLabel("E-mail de trabalho").fill(stranger);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("status")).toHaveText("Mandamos um código de 6 números para o seu e-mail. Ele vale por 10 minutos.");
  expect(await mailCode(stranger, 3000)).toBeNull();
  // A made-up code is refused like a wrong one.
  await page.getByLabel("Código que chegou no e-mail").fill("123456");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("status")).toHaveText("Código errado. Confira e tente de novo.");
  expect(page.url()).toMatch(/\/console\/login$/);
});

test.describe("as Fundador", () => {
  test("E03_C00_founder_logs_in_end_to_end_and_sees_C01_and_C14", async ({ page }) => {
    await loginToConsole(page, FOUNDER_EMAIL);
    // C01 from data (G-SYN): four accounts, one with iFood connected.
    await expect(page.getByText("dados fictícios")).toBeVisible();
    await expect(page.getByText("restaurantes no funil").locator("..")).toContainText("4");
    await expect(page.getByText("com iFood conectado").locator("..")).toContainText("1");
    await expect(page.getByRole("link", { name: "Grupo Exemplo (código G-02)" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: /Configurações/ })).toBeVisible();

    // Logged in, C00 sends back to C01.
    await page.goto("/console/login");
    await page.waitForURL("**/console");

    // C14, A06: the page says which secrets are set and never carries a value.
    const res = await page.goto("/console/config");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
    await expect(page.locator('[data-secret="IFOOD_CLIENT_SECRET"]')).toHaveAttribute("data-state", "set");
    await expect(page.locator('[data-secret="EMAIL_PROVIDER_KEY"]')).toHaveAttribute("data-state", "missing");

    const html = await (await page.request.get("/console/config")).text();
    const rsc = await (await page.request.get("/console/config", { headers: { RSC: "1" } })).text();
    mkdirSync(RESPONSES, { recursive: true });
    writeFileSync(path.join(RESPONSES, "C14.html"), html);
    writeFileSync(path.join(RESPONSES, "C14.rsc.txt"), rsc);
    for (const body of [html, rsc]) {
      expect(body).toContain("IFOOD_CLIENT_SECRET");
      for (const value of Object.values(E2E_FAKE_SECRETS)) expect(body).not.toContain(value);
      expect(body).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    }

    // C20 from the sidebar: 16 keys of 04 §6, seed exceptions, plan defaults.
    const nav = page.getByRole("navigation", { name: "Console" });
    await nav.getByRole("link", { name: /Funcionalidades$/ }).click();
    await page.waitForURL("**/console/funcionalidades");
    await expect(page.getByRole("heading", { name: "Funcionalidades" })).toBeVisible();
    await expect(page.locator("tr[data-flag]")).toHaveCount(16);
    const ifood = page.locator('tr[data-flag="m2.ifood_api"]');
    await expect(ifood).toContainText("Leitura do iFood pela API oficial");
    await expect(ifood.getByRole("button", { name: "m2.ifood_api Raio-X: desligada" })).toBeVisible();
    await expect(ifood.getByRole("button", { name: "m2.ifood_api Lucro: ligada" })).toBeVisible();
    await expect(ifood.locator('[data-exception="G-03"]')).toContainText("G-03 ligada: ligada no teste grátis");
    await page.getByLabel("Ambiente").selectOption("production");
    await page.waitForURL("**/console/funcionalidades?amb=production");
    await expect(page.getByLabel("Ambiente")).toHaveValue("production");

    // C21 from the sidebar: the seven seed alerts, most urgent first.
    await nav.getByRole("link", { name: /Alertas$/ }).click();
    await page.waitForURL("**/console/alertas");
    await expect(page.getByRole("heading", { name: "Alertas" })).toBeVisible();
    await expect(page.locator("tr[data-alert]")).toHaveCount(7);
    await expect(page.locator("tr[data-alert]").first()).toContainText("Importação da API falhou 2 vezes: token expirado");
    await expect(page.locator("tr[data-alert]").first()).toContainText("e-mail e WhatsApp da equipe");
    // E02 opens from C21 (wave 2, apps/web/emails).
    await expect(page.getByRole("link", { name: "Ver e-mail que o dono recebe" })).toHaveAttribute("href", "/console/emails/deadline_soon");
  });

  test("A06_saved_responses_pass_secret_scan", () => {
    const out = execFileSync("uv", ["run", "python", "scripts/secret_scan.py", RESPONSES], { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain("secret_scan: ok");
  });
});

test.describe("as Operação", () => {
  const email = `e2e-operacao-${tag}@teste.local`;
  let cleanup: () => Promise<void> = async () => {};
  test.beforeAll(async () => {
    cleanup = await createStaff(email, "Operação e2e", "operacao");
  });
  test.afterAll(async () => cleanup());

  test("C00_C14_operacao_gets_404_on_config_and_never_sees_C14_C15_C20", async ({ page }) => {
    await loginToConsole(page, email);
    const nav = page.getByRole("navigation", { name: "Console" });
    await expect(nav.getByRole("link", { name: /Clientes$/ })).toBeVisible();
    for (const label of ["Configurações", "Assinaturas", "Funcionalidades"]) await expect(nav.getByText(label)).toHaveCount(0);

    const res = await page.goto("/console/config");
    expect(res?.status()).toBe(404);
    const body = await (await page.request.get("/console/config")).text();
    expect(body).not.toContain("IFOOD_CLIENT_SECRET");
    expect(body).not.toContain("Autorizações dos donos");
  });

  test("C20_C21_operacao_gets_404_on_funcionalidades_and_resolves_an_alert", async ({ page }) => {
    await loginToConsole(page, email);
    expect((await page.goto("/console/funcionalidades"))?.status()).toBe(404);

    const db = adminDb();
    const title = `Alerta e2e ${tag}`;
    const { data: acc } = await db.from("account").select("id").eq("code", "G-02").single();
    const { data: alert } = await db
      .from("alert")
      .insert({ severity: "baixo", title, account_id: acc!.id, link: "/console/contas/G-02/estrutura", notified_via: ["team_email"] })
      .select("id")
      .single();
    try {
      await page.goto("/console");
      await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: /Alertas$/ }).click();
      await page.waitForURL("**/console/alertas");
      const row = page.locator(`tr[data-alert="${alert!.id}"]`);
      await expect(row).toContainText("Grupo Exemplo (G-02)");
      await expect(row.getByRole("link", { name: "vincular" })).toHaveAttribute("href", "/console/contas/G-02/estrutura");
      await row.getByRole("button", { name: `resolver: ${title}` }).click();
      await expect(row).toHaveCount(0);

      const { data: me } = await db.from("person").select("id").eq("email", email).single();
      const { data: saved } = await db.from("alert").select("resolved_at, resolved_by").eq("id", alert!.id).single();
      expect(saved!.resolved_by).toBe(me!.id);
      expect(saved!.resolved_at).not.toBeNull();
      const { data: audit } = await db.from("audit_log").select("action, actor_kind").eq("entity_id", alert!.id);
      expect(audit).toEqual([{ action: "alert.resolve", actor_kind: "staff" }]);
    } finally {
      await db.from("alert").delete().eq("id", alert!.id);
    }
  });
});
