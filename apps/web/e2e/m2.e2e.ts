// Module 2 from files (07: C02, C03). Local stack with the G-SYN seed; worker-import runs as a plain process
// (`uv run worker <type> --local --once`), as in local development (02 §3).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminDb, FOUNDER_EMAIL, loginToConsole, ROOT } from "./helpers";

const FIXTURES = path.join(ROOT, "fixtures", "m2");
const SEPT_CHANGED = path.join(FIXTURES, "99food-extrato-set2026-SINTETICO.xlsx");
const OCT_CHANGED = path.join(FIXTURES, "99food-extrato-out2026-SINTETICO.xlsx");

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let accountId = "";
let signature = "";
const created: string[] = [];

function dbUrl(): string {
  const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  return status.DB_URL as string;
}

/** Run worker-import until the run leaves the queue. */
async function work(jobType: string, runId: string): Promise<{ status: string; rows_new: number | null; rows_duplicate: number | null; rows_total: number | null }> {
  const db = adminDb();
  for (let i = 0; i < 5; i++) {
    execFileSync("uv", ["run", "worker", jobType, "--local", "--once"], { cwd: ROOT, env: { ...process.env, MARGO_LOCAL_DB_URL: dbUrl() }, stdio: "ignore" });
    const { data } = await db.from("import_run").select("status, rows_new, rows_duplicate, rows_total").eq("id", runId).single();
    if (data && !["queued", "running"].includes(data.status)) return data;
  }
  throw new Error(`run ${runId} still queued`);
}

/** C07 drop zone; returns the import_run the upload created. */
async function upload(file: string): Promise<string> {
  const since = new Date().toISOString();
  await page.goto("/console/contas/G-02/importacoes");
  await page.getByLabel("Arquivo", { exact: true }).setInputFiles(file);
  await page.getByLabel("Canal do arquivo").selectOption("food99");
  await page.getByRole("button", { name: "Importar" }).click();
  let id: string | undefined;
  await expect
    .poll(async () => {
      const { data } = await adminDb().from("import_run").select("id").eq("account_id", accountId).eq("file_name", path.basename(file)).gt("created_at", since).limit(1);
      id = data?.[0]?.id;
      return id;
    })
    .toBeTruthy();
  created.push(id!);
  return id!;
}

async function forgetChangedLayout() {
  await adminDb().from("column_mapping").delete().eq("channel", "food99").eq("file_signature", signature);
}

test.beforeAll(async ({ browser }) => {
  const db = adminDb();
  accountId = (await db.from("account").select("id").eq("code", "G-02").single()).data!.id;
  const { data: seeded } = await db.from("import_run").select("log").eq("account_id", accountId).eq("status", "needs_mapping").limit(1).single();
  signature = (seeded!.log as { signature: string }).signature;
  await forgetChangedLayout();
  context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  page = await context.newPage();
  await loginToConsole(page, FOUNDER_EMAIL);
});

// Leave G-SYN as seeded: the changed layout unknown again, October's rows and the test runs gone.
test.afterAll(async () => {
  const db = adminDb();
  await forgetChangedLayout();
  if (created.length) {
    await db.from("ledger_entry").delete().in("import_run_id", created);
    await db.from("order_fact").delete().in("import_run_id", created);
    await db.from("alert").delete().in("link", created.map((id) => `/console/importacoes/${id}/corrigir`));
    await db.from("import_run").delete().in("id", created);
  }
  await db.from("close_period").delete().eq("account_id", accountId).eq("month", "2026-10-01");
  await context?.close();
});

test("C02_changed_99food_layout_needs_mapping_then_C17_totals_match_and_next_file_imports_alone", async () => {
  const db = adminDb();
  const auditSince = new Date().toISOString();

  // A September statement in a changed layout goes to needs_mapping (04 §11).
  const run = await upload(SEPT_CHANGED);
  expect((await work("import_99food_file", run)).status).toBe("needs_mapping");
  await page.reload();
  const row = page.locator(`tr[data-run="${run}"]`);
  await expect(row).toContainText("3 colunas novas");
  await expect(row).toContainText("upload (Marlon)");

  // C17: the new columns, the check block, then save and reprocess.
  await row.getByRole("link", { name: "corrigir" }).click();
  await page.waitForURL(`**/console/importacoes/${run}/corrigir`);
  await expect(page.getByRole("heading", { name: "Corrigir importação" })).toBeVisible();
  await expect(page.getByText("O arquivo da 99Food mudou de formato.")).toBeVisible();
  for (const name of ["Subsídio da plataforma", "Ajuste CBS/IBS", "Repasse dividido"]) {
    await expect(page.locator(`tr[data-column="${name}"]`)).toContainText("nova: confirmar");
  }
  await expect(page.locator('tr[data-column="Valor dos itens"]')).toContainText("conhecida");
  await expect(page.locator("[data-check]")).toContainText("Linhas no arquivo: 1.022");
  await expect(page.locator("[data-check]")).toContainText("Soma do repasse no arquivo: R$ 14.471,00");
  await expect(page.locator("[data-check]")).toContainText("Soma depois do mapeamento: R$ 14.471,00 · bate");
  // Saving is refused while a new column has no decision.
  await page.getByRole("button", { name: "Salvar e reprocessar" }).click();
  await expect(page.getByRole("status")).toContainText("Diga o que significa");
  await page.getByLabel("Vira o campo: Subsídio da plataforma").selectOption({ label: "promoção paga pelo app" });
  await page.getByLabel("Vira o campo: Ajuste CBS/IBS").selectOption({ label: "imposto retido" });
  await page.getByLabel("Vira o campo: Repasse dividido").selectOption({ label: "parcela do repasse" });
  await page.getByRole("button", { name: "Salvar e reprocessar" }).click();
  await page.waitForURL("**/console/contas/G-02/importacoes");

  // Reprocessed: totals match, every row is the September already imported (re-import adds zero rows).
  const done = await work("import_99food_file", run);
  expect(done).toMatchObject({ status: "ok", rows_new: 0, rows_duplicate: 1022, rows_total: 1022 });
  await page.reload();
  await expect(page.locator(`tr[data-run="${run}"]`)).toContainText("importado");

  // The next file with the same layout imports alone, without C17.
  const next = await upload(OCT_CHANGED);
  const oct = await work("import_99food_file", next);
  expect(oct.status).toBe("ok");
  expect(oct.rows_new).toBe(oct.rows_total);

  // A04: the upload and the mapping are in audit_log, by staff.
  const { data: audit } = await db.from("audit_log").select("action, actor_kind").eq("account_id", accountId).gt("at", auditSince);
  const actions = (audit ?? []).map((a) => a.action);
  expect(actions.filter((a) => a === "import_run.upload")).toHaveLength(2);
  expect(actions).toContain("column_mapping.save");
  expect(new Set((audit ?? []).map((a) => a.actor_kind))).toEqual(new Set(["staff"]));
});

test("C03_C08_close_and_C09_differences_match_the_seed_and_each_difference_lists_its_orders", async () => {
  await page.goto("/console/contas/G-02/fechamento/2026-09");
  await expect(page.getByRole("heading", { name: "Fechamento de setembro, por canal" })).toBeVisible();
  const cells = async (channel: string) => (await page.locator(`tr[data-channel="${channel}"] td`).allInnerTexts()).map((t) => t.trim());
  expect(await cells("iFood")).toEqual(["iFood", "R$ 92.400", "−11.088", "−2.957", "−4.620", "−3.696", "−1.210", "R$ 68.829", "74,5%"]);
  expect(await cells("99Food")).toEqual(["99Food", "R$ 18.600", "−1.674", "−595", "−1.302", "−558", "0", "R$ 14.471", "77,8%"]);
  expect(await cells("Total")).toEqual(["Total", "R$ 111.000", "−12.762", "−3.552", "−5.922", "−4.254", "−1.210", "R$ 83.300", "75,0%"]);
  await expect(page.locator("[data-banner]")).toContainText("6 diferenças no repasse, somando R$ 1.184. 4 certas, 2 prováveis.");

  await page.locator("[data-banner]").click();
  await page.waitForURL("**/console/contas/G-02/fechamento/2026-09/diferencas");
  await expect(page.getByText("certas (4), prontas para contestar")).toBeVisible();
  await expect(page.getByText("R$ 956")).toBeVisible();
  await expect(page.getByText("R$ 228")).toBeVisible();
  await expect(page.getByText("0,9%")).toBeVisible();
  const rows = page.locator("tr[data-difference]");
  await expect(rows).toHaveCount(6);
  const drawn = [
    ["DIF-01", "Comissão de 15% onde o contrato diz 12%", "iFood", "214", "R$ 412", "certa", "contestada em 02/out"],
    ["DIF-02", "Cancelamento pelo cliente cobrado da loja", "iFood", "9", "R$ 238", "certa", "creditado R$ 238"],
    ["DIF-03", "Cupom cofinanciado debitado inteiro da loja", "iFood", "31", "R$ 186", "certa", "contestar até 15/nov"],
    ["DIF-02", "Cancelamento por atraso do entregador", "99Food", "5", "R$ 120", "certa", "contestar até 20/nov"],
    ["DIF-03", "Promoção da semana sem acordo registrado", "iFood", "22", "R$ 148", "provável", "perguntar ao dono"],
    ["DIF-04", "Repasse da semana 37 menor que a apuração", "99Food", "1", "R$ 80", "provável", "esperar o próximo ciclo"],
  ];
  for (let i = 0; i < drawn.length; i++) {
    const texts = (await rows.nth(i).locator("td").allInnerTexts()).map((t) => t.trim()).slice(1);
    expect(texts).toEqual(drawn[i]);
    // Each difference lists its orders: the sheet has one line per order, adding up to the value.
    const href = await rows.nth(i).getByRole("link").getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(Number(drawn[i][3]) + 1);
    const sum = lines.slice(1).reduce((a, l) => a + Math.round(Number(l.split(";").at(-1)!.replace(",", ".")) * 100), 0);
    expect(`R$ ${Math.round(sum / 100)}`).toBe(drawn[i][4]);
  }

  // C16: the drawn totals and the ready text of the co-funded coupon.
  await page.goto("/console/contas/G-02/contestacoes");
  await expect(page.locator("[data-totals]")).toContainText("R$ 306a contestar");
  await expect(page.locator("[data-totals]")).toContainText("R$ 412contestada, em análise");
  await expect(page.locator("[data-totals]")).toContainText("R$ 238creditada");
  await expect(page.locator("[data-totals]")).toContainText("R$ 228esperando o dono ou o repasse");
  await expect(page.locator("[data-claim]")).toContainText("Texto pronto · DIF-03, cupom cofinanciado");
  await expect(page.getByLabel("O dono cola isto no chamado do Portal do Parceiro")).toHaveValue(
    "Em setembro, 31 pedidos com o cupom da campanha de 20% tiveram o desconto debitado inteiro da loja. Pelo acordo da campanha, o iFood cofinancia metade. Diferença: R$ 186,00. Segue planilha com os pedidos.",
  );
  await expect(page.getByRole("link", { name: "Baixar planilha (31 pedidos)" })).toBeVisible();
  await expect(page.locator('tr[data-contestation="DIF-01"]')).toContainText("dono, 02/out · protocolo 48213");
  await expect(page.locator('tr[data-contestation="DIF-02"]').first()).toContainText("MargoAI, repasse de 14/out");
});

test("C16_staff_cannot_set_creditada_and_C19_shows_the_structure", async () => {
  const db = adminDb();
  // The database refuses creditada from staff (04 §3); only the system sets it.
  const { data: c } = await db.from("contestation").select("id").eq("account_id", accountId).eq("status", "contestada").limit(1).single();
  const { error } = await db.rpc("contestation_mark", { p_contestation: c!.id, p_event: "credito_encontrado", p_actor_kind: "staff", p_actor: (await db.from("person").select("id").eq("email", FOUNDER_EMAIL).single()).data!.id });
  expect(error?.message).toContain("not allowed");

  await page.goto("/console/contas/G-02/estrutura");
  await expect(page.getByRole("heading", { name: "Estrutura do cliente" })).toBeVisible();
  await expect(page.locator("tr[data-store]")).toHaveCount(7);
  await expect(page.getByText("cozinhas (2 cobradas)")).toBeVisible();
  await expect(page.locator('tr[data-store="e801b6c4-…-12"]')).toContainText("sem cozinha: vincular");
  await expect(page.locator('tr[data-store="5d2f8e3a-…-7c"]')).toContainText("fora da análise");
});
