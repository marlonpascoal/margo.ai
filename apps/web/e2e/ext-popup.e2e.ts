// P04 popup end to end against the local server: the built extension page with a stand-in for the two Chrome
// APIs it uses (storage, the active tab's URL). The real extension calls our API under its host permission;
// a plain page has CORS, so this browser runs without web security. Pairs with a code, reads the status,
// sends the file the owner picks. Leaves G-SYN as seeded.
import { createHash, randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import { buildExtension, chromeStub, PORTAL_TAB } from "./extension-helpers";
import { adminDb, sid } from "./helpers";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

test.use({ launchOptions: { args: ["--disable-web-security"] }, viewport: { width: 380, height: 560 } });

const created: { runs: string[]; tokens: string[] } = { runs: [], tokens: [] };

test.afterAll(async () => {
  const db = adminDb();
  if (created.runs.length) {
    const { data } = await db.from("import_run").select("job_id").in("id", created.runs);
    await db.from("audit_log").delete().in("entity_id", created.runs);
    await db.from("import_run").delete().in("id", created.runs);
    const jobs = (data ?? []).map((r) => r.job_id).filter(Boolean) as string[];
    if (jobs.length) await db.from("job").delete().in("id", jobs);
  }
  if (created.tokens.length) {
    await db.from("audit_log").delete().in("entity_id", created.tokens);
    await db.from("extension_token").delete().in("id", created.tokens);
  }
});

test("P04_popup_pairs_with_a_code_and_sends_the_file_the_owner_picks", async ({ page, baseURL }) => {
  const db = adminDb();
  const popup = buildExtension(baseURL!);
  const letters = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const code = `${letters.slice(0, 4)}-${letters.slice(4)}`;
  const { data: pending } = await db
    .from("extension_token")
    .insert({ person_id: sid("p:g01-dono"), account_id: sid("G-01"), token_hash: createHash("sha256").update(code).digest("hex"), pairing_expires_at: new Date(Date.now() + 600_000).toISOString() })
    .select("id")
    .single();
  created.tokens.push(pending!.id);

  await page.addInitScript(chromeStub(PORTAL_TAB, null));
  await page.goto(popup);
  await expect(page.locator("#state")).toHaveText("não conectada");
  await page.getByLabel("Código que o portal mostrou").fill(code.toLowerCase());
  await page.getByRole("button", { name: "Conectar" }).click();

  await expect(page.locator("#state")).toHaveText("conectada");
  await expect(page.locator("main")).toContainText("Você está no Portal do Parceiro, loja Pantanos Burguer Igapó.");
  await expect(page.getByText("Relatórios que a MargoAI pediu")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Vendas por item" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Avaliações da loja" })).not.toBeChecked();
  await expect(page.locator("footer")).toHaveText("último envio: 28/out 21:14 · dados fictícios");
  const { data: paired } = await db.from("extension_token").select("paired_at").eq("id", pending!.id).single();
  expect(paired!.paired_at).not.toBeNull();

  // "Exportar e enviar" opens the file chooser; the owner picks the report they exported.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Exportar e enviar" }).click();
  await (await chooser).setFiles({ name: "vendas-por-item-set2026.csv", mimeType: "text/csv", buffer: Buffer.from("Item;Quantidade\nX-Bacon;10\n") });
  await expect(page.getByRole("status")).toHaveText("Arquivo enviado. A MargoAI importa em alguns minutos.");

  const { data: runs } = await db.from("import_run").select("id, trigger, file_name, created_by, log").eq("account_id", sid("G-01")).eq("trigger", "extension");
  created.runs.push(...(runs ?? []).map((r) => r.id));
  expect(runs).toHaveLength(1);
  expect(runs![0]).toMatchObject({ file_name: "vendas-por-item-set2026.csv", created_by: sid("p:g01-dono"), log: { reports: ["vendas_por_item", "promocoes"] } });
});

test("P04_popup_off_the_portal_does_not_send", async ({ page, baseURL }) => {
  const popup = buildExtension(baseURL!);
  await page.addInitScript(chromeStub("https://www.ifood.com.br/", "g-syn-extensao-pantanos"));
  await page.goto(popup);
  await expect(page.locator("main")).toContainText("Abra o Portal do Parceiro nesta aba para mandar os relatórios.");
  await expect(page.getByRole("button", { name: "Exportar e enviar" })).toBeDisabled();
});
