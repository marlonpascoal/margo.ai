// B01 (partial), C02 to C06 against the G-SYN seed: the Pantanos Burguer X-ray of 28/out end to end through
// the screens and the worker steps (run here as `uv run worker <type> --local --once`). The collection from
// public pages is the part waiting for Marlon's recordings: C02 creates the X-ray and its collect job, and
// the job stops before any request with the reason shown in C03 (D47, B02).
import { expect, test, type Page } from "@playwright/test";
import { FOUNDER_EMAIL, adminDb, loginToConsole, runWorker, sid } from "./helpers";

const SEED_XRAY = sid("m1:xray:G-01");
const PANTANOS = "https://www.ifood.com.br/delivery/londrina-pr/pantanos-burguer-igapo/91a9c35d-0000-4000-8000-000000000000";
const SEED_DELIVERED_AT = "2026-10-28T16:00:00-03:00";

async function auditSince(entityId: string, action: string, since: string) {
  const { data, error } = await adminDb().from("audit_log").select("actor_person_id, actor_kind, before, after").eq("entity_id", entityId).eq("action", action).gt("at", since);
  if (error) throw error;
  return data;
}

async function now(): Promise<string> {
  const { data } = await adminDb().from("audit_log").select("at").order("at", { ascending: false }).limit(1);
  return (data?.[0]?.at as string | undefined) ?? "1970-01-01T00:00:00Z";
}

async function founderId(): Promise<string> {
  const { data } = await adminDb().from("person").select("id").eq("email", FOUNDER_EMAIL).single();
  return data!.id as string;
}

const status = (page: Page) => page.getByRole("status");

test.describe.configure({ mode: "serial" });

// Leave the seed as it was even when a step fails.
test.afterAll(async () => {
  const db = adminDb();
  await db.from("xray").update({ status: "delivered", delivered_at: SEED_DELIVERED_AT }).eq("id", SEED_XRAY);
  await db.from("time_log").update({ minutes: 30 }).eq("xray_id", SEED_XRAY).eq("step", "vizinhanca");
  const { data: acc } = await db.from("account").select("id").eq("code", "G-01").single();
  await db.from("feature_override").delete().eq("flag_key", "m1.raio_x").eq("account_id", acc!.id);
  const { data: lead } = await db.from("xray").select("id").neq("id", SEED_XRAY).eq("created_by", await founderId());
  for (const x of lead ?? []) {
    await db.from("job").delete().eq("payload->>xray_id", x.id);
    await db.from("xray").delete().eq("id", x.id);
  }
});

test("B01_B02_C02_to_C06_pantanos_xray_end_to_end_on_the_seed", async ({ page, context }) => {
  const db = adminDb();
  const me = await founderId();
  await loginToConsole(page, FOUNDER_EMAIL);

  await test.step("C02: invalid link rejected inline; the store is found; Buscar vizinhança creates the X-ray and a collect job", async () => {
    const since = await now();
    await page.goto("/console/raio-x/novo");
    await expect(page.getByRole("heading", { name: "Novo raio-X de preço" })).toBeVisible();
    const url = page.getByLabel("Link da loja no iFood");
    await url.fill("https://www.rappi.com.br/restaurantes/123");
    await expect(page.locator("#url-help [role=alert]")).toHaveText("Cole o link de uma loja do iFood: ele termina com o código da loja.");
    await expect(page.getByRole("button", { name: "Buscar vizinhança" })).toBeDisabled();
    await url.fill(PANTANOS);
    await expect(page.getByText("Loja encontrada: Pantanos Burguer · Igapó, Londrina · Lanches")).toBeVisible();
    await expect(page.getByLabel("Raio da vizinhança")).toHaveValue("3");
    await page.getByRole("button", { name: "Buscar vizinhança" }).click();
    await page.waitForURL(/\/console\/raio-x\/[0-9a-f-]{36}\/vizinhanca$/);
    const id = page.url().split("/").at(-2)!;
    await expect(status(page)).toHaveText("Na fila: a busca começa quando o coletor estiver livre.");

    const { data: x } = await db.from("xray").select("status, account_id, radius_km, categories, rules").eq("id", id).single();
    expect(x).toMatchObject({ status: "collecting", radius_km: 3, categories: ["Lanches", "Hambúrguer", "Porções"] });
    expect(x!.rules).toEqual({ exclude_closed: true, exclude_national_chains: true, same_neighborhood_only: false });
    const { data: jobs } = await db.from("job").select("status, account_id").eq("type", "collect").eq("payload->>xray_id", id);
    expect(jobs).toEqual([{ status: "queued", account_id: x!.account_id }]);
    expect(await auditSince(id, "xray.create", since)).toEqual([expect.objectContaining({ actor_person_id: me, actor_kind: "staff" })]);

    // The collector runs and stops before any request: no public page is recorded yet (D47, D40).
    runWorker("collect");
    await page.reload();
    await expect(status(page)).toContainText("Coleta parada antes de começar");
    const { data: done } = await db.from("job").select("status, log").eq("type", "collect").eq("payload->>xray_id", id).single();
    expect(done!.status).toBe("failed");
    expect((done!.log as { error?: string }[]).at(-1)?.error).toBe("AwaitingRecordings");
  });

  await test.step("A05: flag m1.raio_x off for the account hides the X-ray screens (404)", async () => {
    const { data: acc } = await db.from("account").select("id").eq("code", "G-01").single();
    await db.from("feature_override").insert({ flag_key: "m1.raio_x", env: "sandbox", account_id: acc!.id, value: false, reason: "e2e m1" });
    expect((await page.request.get(`/console/raio-x/${SEED_XRAY}`)).status()).toBe(404);
    await db.from("feature_override").delete().eq("flag_key", "m1.raio_x").eq("account_id", acc!.id);
    expect((await page.request.get(`/console/raio-x/${SEED_XRAY}`)).status()).toBe(200);
  });

  await test.step("C03: 107 found, 84 in the set, 23 out with their reasons; counts follow the boxes; Confirmar starts pairing", async () => {
    const since = await now();
    await page.goto(`/console/raio-x/${SEED_XRAY}/vizinhanca`);
    await expect(page.getByRole("heading", { name: "Vizinhança de 3 km" })).toBeVisible();
    await expect(page.getByText("C03 · Módulo 1 · passo 2 de 4 · Pantanos Burguer")).toBeVisible();
    await expect(page.getByText("107 lojas encontradas")).toBeVisible();
    await expect(page.getByText("84 no conjunto · 23 excluídas")).toBeVisible();
    await expect(page.getByText("dados fictícios")).toBeVisible();
    const rows = page.locator("li[data-store]");
    await expect(rows).toHaveCount(107);
    const states = await rows.locator("span.font-mono").allTextContents();
    expect(states.filter((s) => s !== "no conjunto")).toHaveLength(23);
    expect(states.every((s) => s.trim() !== "")).toBe(true);
    for (const [name, detail, state] of [
      ["Loja vizinha 01", "Hambúrguer · 0,4 km", "no conjunto"],
      ["Rede nacional X", "Hambúrguer · 1,5 km", "regra: rede tabelada"],
      ["Loja vizinha 06", "Lanches · 2,3 km", "regra: fechada há 40 dias"],
      ["Loja vizinha 08", "Pizza · 2,9 km", "manual: outra categoria"],
    ]) {
      const row = page.locator(`li[data-store="${name}"]`);
      await expect(row).toContainText(detail);
      await expect(row.locator("span.font-mono")).toHaveText(state);
    }

    const box = page.getByRole("checkbox", { name: "Loja vizinha 01", exact: true });
    await box.uncheck();
    await expect(page.getByRole("button", { name: "Confirmar 83 lojas" })).toBeVisible();
    await expect(page.getByText("83 no conjunto · 24 excluídas")).toBeVisible();
    await expect(page.locator('li[data-store="Loja vizinha 01"] span.font-mono')).toHaveText("manual");
    await expect.poll(async () => (await db.from("xray_store").select("included, exclusion_reason").eq("xray_id", SEED_XRAY).eq("distance_m", 400)).data).toEqual([
      { included: false, exclusion_reason: "manual" },
    ]);
    await box.check();
    await expect(page.getByRole("button", { name: "Confirmar 84 lojas" })).toBeVisible();
    await expect.poll(async () => (await db.from("xray_store").select("included").eq("xray_id", SEED_XRAY).eq("distance_m", 400)).data).toEqual([{ included: true }]);
    const { data: storeRow } = await db.from("xray_store").select("id").eq("xray_id", SEED_XRAY).eq("distance_m", 400).single();
    await expect.poll(async () => (await auditSince(storeRow!.id, "xray_store.set_included", since)).length).toBe(2);

    await page.getByRole("button", { name: "Confirmar 84 lojas" }).click();
    await page.waitForURL(`**/console/raio-x/${SEED_XRAY}/pareamento`);
    await expect(status(page)).toHaveText("Pareando os itens. Atualize a página em instantes.");
    expect(await auditSince(SEED_XRAY, "xray.confirm_stores", since)).toHaveLength(1);
    runWorker("xray_pair");
  });

  await test.step("C04: totals and rows as drawn; Calcular waits for the review; a weight item shows its unit and price", async () => {
    const since = await now();
    await page.goto(`/console/raio-x/${SEED_XRAY}/pareamento`);
    for (const chip of ["24 itens no cardápio", "19 pareados sozinhos", "3 para revisar", "2 normalizados por peso"]) {
      await expect(page.getByText(chip, { exact: true })).toBeVisible();
    }
    const row = (name: string) => page.locator(`tr[data-item="${name}"]`);
    await expect(row("X-Bacon artesanal")).toContainText("61unidade");
    await expect(row("X-Bacon artesanal")).toContainText("pareado");
    await expect(row("Batata frita média")).toContainText("72por 100 gR$ 4,97");
    await expect(row("Batata frita média")).toContainText("normalizado");
    await expect(row("Refrigerante lata 350 ml")).toContainText("80unidade");
    await expect(row("Milkshake 400 ml")).toContainText("33por 100 ml");
    await expect(row("Combo casal")).toContainText("12combo");
    await expect(row("Combo casal")).toContainText("revisar: combos diferentes");
    await expect(row("Molho especial extra")).toContainText("revisar: poucos pares");
    await expect(row("Sundae")).toContainText("4unidade");
    await expect(page.getByRole("button", { name: "Calcular raio-X" })).toBeEnabled();

    // An item to review that nobody reviewed blocks the calculation.
    const { data: sundae } = await db.from("xray_item_view").select("id").eq("xray_id", SEED_XRAY).eq("name", "Sundae").single();
    await db.from("xray_item").update({ reviewed_at: null, reviewed_by: null }).eq("id", sundae!.id!);
    await page.reload();
    await expect(page.getByRole("button", { name: "Calcular raio-X" })).toBeDisabled();
    await row("Sundae").getByRole("link", { name: "Sundae" }).click();
    const panel = page.getByRole("form", { name: "Pares de Sundae" });
    await expect(panel.getByRole("checkbox")).toHaveCount(4);
    await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(3);
    await panel.getByRole("button", { name: "Salvar pares" }).click();
    await expect(page.getByRole("button", { name: "Calcular raio-X" })).toBeEnabled();
    await expect(row("Sundae")).toContainText("revisado");
    expect(await auditSince(sundae!.id!, "xray_item.review", since)).toEqual([expect.objectContaining({ actor_person_id: me })]);

    await page.getByRole("button", { name: "Calcular raio-X" }).click();
    await page.waitForURL(`**/console/raio-x/${SEED_XRAY}`);
    await expect(status(page)).toHaveText("Calculando o raio-X. Atualize a página em instantes.");
    runWorker("xray_calc");
  });

  await test.step("C05: KPIs, rows, Pareto and method note as drawn, from the worker's numbers", async () => {
    await page.goto(`/console/raio-x/${SEED_XRAY}`);
    for (const [v, l] of [
      ["84", "lojas comparáveis em 3 km"],
      ["24", "itens analisados"],
      ["7", "abaixo da paridade"],
      ["5", "acima da paridade"],
    ]) {
      await expect(page.getByText(l, { exact: true }).locator("..")).toContainText(v + l);
    }
    const row = (name: string) => page.locator(`tr[data-item="${name}"]`);
    await expect(row("Refrigerante lata 350 ml")).toHaveText("Refrigerante lata 350 mlR$ 5,00R$ 6,50−23%pode subir hoje");
    await expect(row("Batata frita média")).toHaveText("Batata frita médiaR$ 14,90R$ 18,40−19%pode subir hoje");
    await expect(row("Milkshake 400 ml")).toHaveText("Milkshake 400 mlR$ 16,90R$ 19,90−15%pode subir hoje");
    await expect(row("Smash duplo")).toHaveText("Smash duploR$ 29,90R$ 30,50−2%na faixa");
    await expect(row("X-Bacon artesanal")).toHaveText("X-Bacon artesanalR$ 36,90R$ 31,50+17%precisa do custo");
    await expect(row("Combo casal")).toHaveText("Combo casalR$ 79,90R$ 69,90+14%precisa do custo");
    const pareto = page.locator("[data-pareto]");
    await expect(pareto).toContainText("6 de 24 itens somam 80% da perda por preço");
    await expect(pareto).toContainText("Batata frita média31%");
    await expect(pareto).toContainText("Refrigerante lata 350 ml53%");
    await expect(pareto).toContainText("Molho especial extra80%");
    await expect(pareto).toContainText("Paridade = mediana dos itens comparáveis no raio de 3 km. Sem custo: subir item barato é seguro, baixar item caro não.");

    await page.getByRole("button", { name: "Preparar entrega" }).click();
    await page.waitForURL(`**/console/raio-x/${SEED_XRAY}/entrega`);
    runWorker("render_xray");
  });

  await test.step("C06: the PDF opens, the message carries the X-ray reference, WhatsApp marks it delivered, hours are saved", async () => {
    const since = await now();
    await page.goto(`/console/raio-x/${SEED_XRAY}/entrega`);
    await expect(page.getByText("PDF · A4 · 2 páginas")).toBeVisible();
    const pdf = await page.request.get(`/console/raio-x/${SEED_XRAY}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(page.getByRole("link", { name: "Abrir o PDF" })).toHaveAttribute("href", `/console/raio-x/${SEED_XRAY}/pdf`);

    const message = page.getByLabel("Texto que vai junto, no WhatsApp do fundador");
    const text = await message.inputValue();
    expect(text).toMatch(
      /^Oi! Fizemos um raio-X dos preços da Pantanos Burguer comparando com 84 lojas num raio de 3 km\. Tem 3 itens que dá para subir hoje sem risco\. O PDF está aqui\. Para saber o que dá lucro de verdade, dá para conectar o iFood em 2 minutos: http:\/\/localhost:\d+\/criar-conta\?ref=/,
    );
    expect(text.endsWith(`/criar-conta?ref=${SEED_XRAY}`)).toBe(true);
    await expect(page.getByLabel("Horas: vizinhança")).toHaveValue("0,5");
    await expect(page.getByLabel("Horas: pareamento")).toHaveValue("1,0");
    await expect(page.getByLabel("Horas: entrega")).toHaveValue("0,3");

    // Click-to-chat opens in a new tab; no request leaves the machine.
    await context.route("https://wa.me/**", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "wa.me (e2e)" }));
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Enviar pelo WhatsApp" }).click()]);
    expect(popup.url()).toContain("https://wa.me/?text=Oi!%20Fizemos%20um%20raio-X");
    expect(decodeURIComponent(popup.url())).toContain(`/criar-conta?ref=${SEED_XRAY}`);
    await popup.close();
    await expect.poll(async () => (await auditSince(SEED_XRAY, "xray.deliver", since)).length).toBe(1);
    const { data: x } = await db.from("xray").select("status, delivered_at").eq("id", SEED_XRAY).single();
    expect(x!.status).toBe("delivered");
    expect(new Date(x!.delivered_at!).getTime()).toBeGreaterThan(Date.now() - 5 * 60_000);

    await page.getByLabel("Horas: vizinhança").fill("0,6");
    await page.getByRole("button", { name: "Salvar e voltar" }).click();
    await page.waitForURL("**/console");
    const { data: logs } = await db.from("time_log").select("step, minutes").eq("xray_id", SEED_XRAY).eq("person_id", me).order("step");
    expect(logs).toEqual([
      { step: "entrega", minutes: 18 },
      { step: "pareamento", minutes: 60 },
      { step: "vizinhanca", minutes: 36 },
    ]);
    expect(await auditSince(SEED_XRAY, "time_log.save", since)).toHaveLength(1);
  });
});
