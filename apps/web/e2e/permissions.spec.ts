// A03 (07-acceptance): a Gerente of kitchen K sees nothing of other kitchens: pages, PDFs, exports.
// G-SYN: Gerente do Centro (Cozinha Centro only) against the Dono of Grupo Exemplo. The P06 close of
// September is rendered by worker-render and the data export by worker-account first.
import { expect, test, type Page } from "@playwright/test";
import { adminDb, runWorker, sid } from "./helpers";
import { portalSession } from "./portal-session";

test.describe.configure({ mode: "serial" });

const G02 = sid("G-02");
const DONO_EMAIL = "dono@exemplo.com.br";
// The seeded Gerente signs in by WhatsApp only; an e-mail is set for this run (auth.whatsapp_code is off).
const GERENTE_EMAIL = "gerente.centro.e2e@exemplo.com.br";
const OTHER_KITCHENS = /Zona Sul|Quiosque Shopping|Milkshake|e801/;

let closeId = "";
let exportJob = "";

test.beforeAll(async () => {
  const db = adminDb();
  await db.from("person").update({ email: GERENTE_EMAIL }).eq("id", sid("p:g02-ger"));
  const { data: cp } = await db.from("close_period").select("id, pdf_path").eq("account_id", G02).single();
  closeId = cp!.id;
  if (!cp!.pdf_path) {
    await db.from("job").insert({ type: "render_close", payload: { close_period_id: closeId }, account_id: G02 });
    runWorker("render_close");
  }
  const { data: job } = await db.from("job").insert({ type: "account_export", payload: { account_id: G02, requested_by: sid("p:g02-dono") }, account_id: G02 }).select("id").single();
  exportJob = job!.id;
  runWorker("account_export");
});

test.afterAll(async () => {
  const db = adminDb();
  const { data: p } = await db.from("person").select("auth_user_id").eq("id", sid("p:g02-ger")).single();
  await db.from("person").update({ email: null, auth_user_id: null }).eq("id", sid("p:g02-ger"));
  await db.from("auth_code_guard").delete().eq("email", GERENTE_EMAIL);
  if (p?.auth_user_id) await db.auth.admin.deleteUser(p.auth_user_id);
  const { data: j } = await db.from("job").select("log").eq("id", exportJob).single();
  const path = (j?.log as { path?: string }[] | undefined)?.find((e) => e.path)?.path;
  if (path) await db.storage.from("exports").remove([path.replace(/^exports\//, "")]);
  await db.from("job").delete().eq("id", exportJob);
});

async function bodyText(page: Page, url: string) {
  const res = await page.goto(url);
  return { status: res!.status(), text: await page.locator("body").innerText() };
}

test("A03_gerente_do_centro_sees_nothing_of_other_kitchens", async ({ page }) => {
  await portalSession(page, GERENTE_EMAIL);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });

    const lojas = await bodyText(page, "/app/lojas");
    expect(lojas.status).toBe(200);
    expect(lojas.text).toContain("Cozinha Centro");
    expect(lojas.text).not.toMatch(OTHER_KITCHENS);
    await expect(page.getByLabel("Incluir Cozinha Centro").first()).toBeDisabled();

    const cont = await bodyText(page, "/app/contestacoes");
    expect(cont.status).toBe(200);
    expect(cont.text).not.toMatch(OTHER_KITCHENS);
    expect(cont.text).not.toMatch(/R\$ 238|R\$ 120/);

    const pessoas = await bodyText(page, "/app/pessoas");
    expect(pessoas.status).toBe(200);
    expect(pessoas.text).toContain("Gerente do Centro");
    expect(pessoas.text).not.toMatch(/Dono do grupo|Pessoa do financeiro|Contador|Convidar pessoa|Convidar pelo/);
  }
  expect((await page.goto("/app/conectar"))!.status()).toBe(404);
  for (const f of ["pdf", "xlsx"]) expect((await page.request.get(`/app/relatorios/fechamento/${closeId}/${f}`)).status(), f).toBe(404);
  expect((await page.request.get(`/app/dados/${exportJob}`)).status()).toBe(404);
});

test("A03_dono_sees_every_kitchen_and_downloads_the_close_and_the_export_then_E04_C04_on_the_pages", async ({ page }) => {
  await portalSession(page, DONO_EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });
  const lojas = await bodyText(page, "/app/lojas");
  expect(lojas.text).toMatch(/Cozinha Zona Sul[\s\S]*Quiosque Shopping/);
  expect(lojas.text).toContain("Apareceu uma loja nova no iFood (Burger do Bairro, id e801…). Em qual cozinha ela fica?");

  const pdf = await page.request.get(`/app/relatorios/fechamento/${closeId}/pdf`);
  expect([pdf.status(), pdf.headers()["content-type"]]).toEqual([200, "application/pdf"]);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  expect((await page.request.get(`/app/relatorios/fechamento/${closeId}/xlsx`)).status()).toBe(200);
  const zip = await page.request.get(`/app/dados/${exportJob}`);
  expect([zip.status(), zip.headers()["content-type"]]).toEqual([200, "application/zip"]);
  expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");

  // Same session (a second code would wait out the 60-second resend rule, 04 §8).
  await dono_E04_W04_last_dono_cannot_demote_self_and_C04_W03_ja_contestei_moves_the_status(page);
});

async function dono_E04_W04_last_dono_cannot_demote_self_and_C04_W03_ja_contestei_moves_the_status(page: Page) {
  const db = adminDb();
  await page.goto("/app/pessoas");
  await page.getByLabel("Perfil de Dono do grupo").selectOption("financeiro");
  await expect(page.getByRole("status").first()).toHaveText("Toda conta precisa de pelo menos um Dono. Faça outra pessoa Dono antes.");
  const { data: m } = await db.from("membership").select("role").eq("id", sid("G-02:m-dono")).single();
  expect(m!.role).toBe("dono");

  // A temporary difference of Cozinha Centro, removed after the test.
  const { data: cp } = await db.from("close_period").select("id").eq("account_id", G02).single();
  const { data: d } = await db
    .from("difference")
    .insert({ account_id: G02, close_period_id: cp!.id, channel_store_id: sid("G-02:s1"), rule_id: "DIF-05", finding_key: `e2e-${Date.now()}`, description: "Teste e2e A03", orders_count: 1, amount_cents: 99_900, confidence: "certa", detail: { short: "Teste e2e A03" } })
    .select("id")
    .single();
  const { data: c } = await db.from("contestation").insert({ account_id: G02, difference_id: d!.id, status: "a_contestar", deadline_on: "2026-12-01", claim_text: "texto" }).select("id").single();
  try {
    await page.goto("/app/contestacoes");
    const row = page.locator("tr", { hasText: "Teste e2e A03" });
    await expect(row).toContainText("a contestar");
    await row.getByLabel("Protocolo (opcional)").fill("99001");
    await row.getByRole("button", { name: "Já contestei" }).click();
    await expect(page.locator("tr", { hasText: "Teste e2e A03" })).toContainText("em análise");
    await expect(page.locator("tr", { hasText: "Teste e2e A03" })).toContainText("protocolo 99001");
    const { data: after } = await db.from("contestation").select("status, marked_by_kind").eq("id", c!.id).single();
    expect(after).toEqual({ status: "contestada", marked_by_kind: "person" });
  } finally {
    await db.from("difference").delete().eq("id", d!.id);
  }
}
