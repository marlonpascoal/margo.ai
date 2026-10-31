// Billing on the local stack (04 §7, 06 §4): P09/W05 with the fake Asaas client (e2e-only wiring in
// app/teste-e2e/asaas), the webhook route's auth, and C15 edits with audit_log. E01 against the real
// Asaas sandbox is Marlon's run on the preview (fixtures/asaas/README.md).
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loginToPortal } from "./billing-helpers";
import { E2E_FAKE_SECRETS } from "./fake-secrets";
import { FOUNDER_EMAIL, adminDb, createStaff, loginToConsole, sid } from "./helpers";

const tag = randomBytes(4).toString("hex");
const G01 = sid("G-01");
const PANTANOS_DONO = "pantanos@exemplo.com.br";
const G02_FINANCEIRO = "financeiro@exemplo.com.br";

test.describe.configure({ mode: "serial" });

/** G-01 back to the seed (trial, no Asaas subscription), whatever an earlier run left. */
async function resetG01() {
  const db = adminDb();
  const lucro = (await db.from("plan").select("id").eq("code", "lucro").single()).data!.id;
  await db.from("billing_invoice").delete().eq("account_id", G01);
  await db.from("billing_event").delete().like("asaas_event_id", "evt_e2e_%");
  await db.from("alert").delete().eq("account_id", G01).eq("title", "Pediu o plano Rede");
  await db.from("account").update({ plan_id: lucro }).eq("id", G01);
  await db
    .from("subscription")
    .update({
      plan_id: lucro,
      status: "trial",
      asaas_customer_id: "cus_000000077c2",
      asaas_subscription_id: null,
      next_due_on: null,
      units_billed: 1,
      last_event: "conta criada",
      last_event_at: "2026-10-25T10:00:00-03:00",
    })
    .eq("account_id", G01);
  await db.from("import_source").update({ paused_at: null, paused_reason: null }).eq("account_id", G01);
}

test.beforeAll(resetG01);
test.afterAll(resetG01);

test("E01_webhook_route_refuses_missing_and_wrong_tokens", async ({ request }) => {
  const url = "/api/asaas/webhook";
  expect((await request.post(url, { data: {} })).status()).toBe(401);
  expect((await request.post(url, { data: {}, headers: { "asaas-access-token": "dummy-wrong-token" } })).status()).toBe(401);
  // Right token, a body that is not an event: refused before anything is stored.
  const bad = await request.post(url, { data: {}, headers: { "asaas-access-token": E2E_FAKE_SECRETS.ASAAS_WEBHOOK_TOKEN } });
  expect(bad.status()).toBe(400);
  expect(await bad.text()).not.toContain(E2E_FAKE_SECRETS.ASAAS_WEBHOOK_TOKEN);
  expect((await request.get("/api/cron/billing")).status()).toBe(401);
});

test("P09_W05_without_session_goes_to_entrar", async ({ page }) => {
  await page.goto("/app/plano");
  expect(page.url()).toMatch(/\/entrar$/);
});

test.describe("as Dono of Pantanos (G-01, trial)", () => {
  test("P09_phone_picks_a_plan_and_W05_rede_creates_an_alert", async ({ page }) => {
    await loginToPortal(page, PANTANOS_DONO);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/plano");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Seu teste grátis acaba (em \d+ dias?|hoje)$/);
    await expect(page.getByText("Escolha como continuar. Se não escolher, a conta volta para o plano grátis e nada é cobrado.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lucro/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Lucro/ })).toContainText("R$ 300/loja/mês");
    await expect(page.getByRole("button", { name: "Continuar para o pagamento" })).toBeVisible();
    await page.getByRole("button", { name: /^Raio-X/ }).click();
    await expect(page.getByText("Escolhido: Raio-X")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ficar no grátis" })).toHaveAttribute("href", "/app");
    await page.getByRole("button", { name: /^Rede/ }).click();
    await expect(page.getByText("a combinar")).toBeVisible();
    await expect(page.getByText("Só cartão de crédito. Cancele quando quiser.")).toBeVisible();

    // W05 "Falar com a gente" (Rede): an alert for the founders, no checkout (04 §7).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/app/plano");
    await page.getByRole("region", { name: "Plano Rede" }).getByRole("button", { name: "Falar com a gente" }).click();
    await expect(page.getByText("Recebemos o pedido. Os fundadores falam com você em breve.").filter({ visible: true })).toBeVisible();
    const { data } = await adminDb().from("alert").select("severity, link").eq("account_id", G01).eq("title", "Pediu o plano Rede").is("resolved_at", null);
    expect(data).toEqual([{ severity: "medio", link: "/console/assinaturas" }]);
  });

  test("E01_W05_checkout_to_processando_then_webhook_active_and_replay_changes_nothing", async ({ page }) => {
    const db = adminDb();
    await loginToPortal(page, PANTANOS_DONO);
    await page.goto("/teste-e2e/asaas?acao=ligar");
    await expect(page.locator("[data-asaas-fake=on]")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/app/plano");
    await expect(page.getByRole("heading", { name: "Plano e cobrança" })).toBeVisible();
    await expect(page.getByText("Teste grátis até 08/nov. Só cartão de crédito, pelo Asaas.")).toBeVisible();
    await expect(page.getByText("preços de exemplo · dados fictícios").filter({ visible: true })).toBeVisible();
    const lucro = page.getByRole("region", { name: "Plano Lucro" });
    await expect(lucro).toContainText("R$ 300 por loja/mês");
    // 05 P09/W05 "Done when": total = price x units in analysis (G-01: one store in Igapó).
    await expect(lucro).toContainText("1 loja na análise = R$ 300/mês");
    await expect(page.getByText("Nenhuma fatura ainda. A primeira sai quando o teste acabar e você escolher um plano.")).toBeVisible();

    // "Assinar pelo Asaas" -> the hosted checkout (fake): recurring card, first charge on the trial end.
    await lucro.getByRole("button", { name: "Assinar pelo Asaas" }).click();
    await page.waitForURL("**/teste-e2e/asaas/checkout?**");
    await expect(page.locator("[data-field=value]")).toHaveText("R$ 300,00");
    await expect(page.locator("[data-field=next-due]")).toHaveText("2026-11-08");
    await expect(page.locator("[data-field=description]")).toHaveText("1 loja · cobrança mensal no cartão");
    const { data: audit } = await db.from("audit_log").select("actor_kind, actor_person_id, after").eq("account_id", G01).eq("action", "subscription.checkout_start").order("at", { ascending: false }).limit(1).single();
    expect(audit).toMatchObject({ actor_kind: "person", actor_person_id: sid("p:g01-dono"), after: { value_cents: 30000, units: 1, next_due_date: "2026-11-08" } });

    // Back from Asaas: "processando" until the webhook (05 P10); the status did not move (D27).
    await page.getByRole("link", { name: "Assinar" }).click();
    await page.waitForURL("**/app/plano?status=sucesso");
    await expect(page.getByRole("status").filter({ visible: true })).toHaveText("Pagamento processando. Assim que o Asaas confirmar, o plano aparece aqui.");
    expect((await db.from("subscription").select("status").eq("account_id", G01).single()).data!.status).toBe("trial");

    // Webhooks (internal events through handleAsaasWebhook): subscription created, then payment confirmed.
    await page.goto(`/teste-e2e/asaas?acao=evento&conta=G-01&tipo=subscription_created&id=evt_e2e_sc_${tag}`);
    await expect(page.locator("main")).toHaveAttribute("data-outcome", "applied");
    await page.goto("/app/plano?status=sucesso");
    await expect(page.getByText("Plano Lucro escolhido. A primeira cobrança sai em 08/nov, quando o teste acabar. Só cartão de crédito, pelo Asaas.")).toBeVisible();

    const paid = `evt_e2e_pc_${tag}`;
    await page.goto(`/teste-e2e/asaas?acao=evento&conta=G-01&tipo=payment_confirmed&id=${paid}`);
    await expect(page.locator("main")).toHaveAttribute("data-outcome", "applied");
    const after = (await db.from("subscription").select("*").eq("account_id", G01).single()).data!;
    expect(after).toMatchObject({ status: "active", asaas_subscription_id: "sub_e2e_G-01", next_due_on: "2026-12-08", last_event: "pagamento confirmado" });
    await page.goto("/app/plano");
    await expect(page.getByText("Seu plano: Lucro. Próxima cobrança em 08/dez. Só cartão de crédito, pelo Asaas.")).toBeVisible();
    const invoice = page.getByRole("table").getByRole("row").nth(1);
    await expect(invoice).toContainText("nov/2026");
    await expect(invoice).toContainText("R$ 300,00");
    await expect(invoice).toContainText("paga");
    // 04 §9 billing_result to the Dono, e-mail locked on.
    const { data: notice } = await db.from("notification").select("channel, subject").eq("account_id", G01).eq("notice_code", "billing_result").order("created_at", { ascending: false }).limit(1).single();
    expect(notice).toEqual({ channel: "email", subject: "Cobrança aprovada" });

    // The same event delivered again changes nothing (C15 "Done when", E01).
    const audits = (await db.from("audit_log").select("id", { count: "exact", head: true }).eq("account_id", G01)).count;
    await page.goto(`/teste-e2e/asaas?acao=evento&conta=G-01&tipo=payment_confirmed&id=${paid}`);
    await expect(page.locator("main")).toHaveAttribute("data-outcome", "duplicate");
    expect((await db.from("subscription").select("*").eq("account_id", G01).single()).data).toEqual(after);
    expect((await db.from("billing_event").select("id", { count: "exact", head: true }).eq("asaas_event_id", paid)).count).toBe(1);
    expect((await db.from("audit_log").select("id", { count: "exact", head: true }).eq("account_id", G01)).count).toBe(audits);
  });
});

test("P09_W05_financeiro_gets_404", async ({ page }) => {
  await loginToPortal(page, G02_FINANCEIRO);
  expect((await page.goto("/app/plano"))?.status()).toBe(404);
});

test.describe("C15 as Fundador", () => {
  test("C15_shows_subscriptions_and_pilots_and_audits_plan_and_pilot_edits", async ({ page }) => {
    const db = adminDb();
    await resetG01();
    await loginToConsole(page, FOUNDER_EMAIL);
    await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: /Assinaturas$/ }).click();
    await page.waitForURL("**/console/assinaturas");
    await expect(page.getByRole("heading", { name: "Assinaturas" })).toBeVisible();
    await expect(page.getByText("dados fictícios · Asaas sandbox")).toBeVisible();
    await expect(page.getByText("receita mensal").locator("..")).toContainText("R$ 1.800");
    await expect(page.getByText("em teste grátis (14 dias)")).toBeVisible();
    const g02 = page.getByRole("row", { name: /Grupo Exemplo \(G-02\)/ });
    await expect(g02).toContainText("ativa");
    await expect(g02).toContainText("05/nov · R$ 1.800");
    await expect(g02).toContainText("sub_…a91f");
    await expect(page.getByRole("row", { name: /Grupo C \(G-04\)/ })).toContainText("não cobra");

    // Pilot of Grupo B: cap set, then back to open; each save audited (D37).
    const pilot = page.getByRole("form", { name: "Piloto Grupo B (G-03)" });
    await expect(pilot.getByLabel("Meses 1 e 2: % do creditado")).toHaveValue("20%");
    await expect(pilot.getByTestId(/pilot-next-/)).toHaveText(/^20% de R\$ [\d.,]+ creditados = R\$ [\d.,]+$/);
    await pilot.getByLabel("Teto por mês").fill("R$ 500");
    await pilot.getByRole("button", { name: "Salvar" }).click();
    await expect(pilot.getByRole("status")).toHaveText("Salvo.");
    const g03 = sid("G-03");
    expect((await db.from("pilot").select("cap_cents").eq("account_id", g03).single()).data!.cap_cents).toBe(50000);
    const { data: pa } = await db.from("audit_log").select("actor_kind, actor_person_id, before, after").eq("action", "pilot.update").eq("account_id", g03).order("at", { ascending: false }).limit(1).single();
    expect(pa).toMatchObject({ actor_kind: "staff", actor_person_id: sid("p:marlon"), before: { cap_cents: null }, after: { cap_cents: 50000 } });
    await page.reload();
    await pilot.getByLabel("Teto por mês").fill("");
    await pilot.getByRole("button", { name: "Salvar" }).click();
    await expect(pilot.getByRole("status")).toHaveText("Salvo.");
    expect((await db.from("pilot").select("cap_cents").eq("account_id", g03).single()).data!.cap_cents).toBeNull();
    await pilot.getByLabel("Meses 1 e 2: % do creditado").fill("abc");
    await pilot.getByRole("button", { name: "Salvar" }).click();
    await expect(pilot.getByRole("alert")).toHaveText("Percentual inválido. Use, por exemplo, 20%.");

    // Plan editor (D40: data, not code): trial days 14 -> 21 -> 14, audited with before and after.
    const lucro = page.getByRole("form", { name: "Plano Lucro" });
    await page.reload();
    await lucro.getByLabel("Dias de teste grátis").fill("21");
    await lucro.getByRole("button", { name: "Salvar" }).click();
    await expect(lucro.getByRole("status")).toHaveText("Salvo.");
    await expect(page.getByText("em teste grátis (21 dias)")).toBeVisible();
    const { data: plan } = await db.from("audit_log").select("actor_kind, before, after").eq("action", "plan.update").order("at", { ascending: false }).limit(1).single();
    expect(plan).toMatchObject({ actor_kind: "staff", before: { trial_days: 14, price_cents: 30000 }, after: { trial_days: 21, price_cents: 30000 } });
    await page.reload();
    await lucro.getByLabel("Dias de teste grátis").fill("14");
    await lucro.getByRole("button", { name: "Salvar" }).click();
    await expect(lucro.getByRole("status")).toHaveText("Salvo.");
    expect((await db.from("plan").select("trial_days").eq("code", "lucro").single()).data!.trial_days).toBe(14);
  });
});

test.describe("C15 as Operação", () => {
  const email = `e2e-operacao-c15-${tag}@teste.local`;
  let cleanup: () => Promise<void> = async () => {};
  test.beforeAll(async () => {
    cleanup = await createStaff(email, "Operação e2e", "operacao");
  });
  test.afterAll(async () => cleanup());

  test("C15_operacao_gets_404", async ({ page }) => {
    await loginToConsole(page, email);
    expect((await page.goto("/console/assinaturas"))?.status()).toBe(404);
    const body = await (await page.request.get("/console/assinaturas")).text();
    expect(body).not.toContain("receita mensal");
  });
});
