// Wave 2 extension and messages, console side: C18 as drawn (brand, branded P06), C21 WhatsApp queue (E05)
// and the notice e-mail preview (E01, E02), P04 pairing from the console, and A05 for C18 and the P04 page.
// One founder login (codes have a 60-second resend window). Leaves G-SYN as seeded.
import { expect, test } from "@playwright/test";
import { FOUNDER_EMAIL, adminDb, loginToConsole, runWorker, sid } from "./helpers";

test.describe.configure({ mode: "serial" });

const BPO01 = sid("bpo-01");
const CLOSE = sid("G-02:close:2026-09");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#0A7A3D"/></svg>';
const quiet = () => {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h >= 22 || h < 8;
};

test.afterAll(async () => {
  const db = adminDb();
  await db.from("bpo_partner").update({ primary_color: "#1351B4", show_powered_by: false, logo_path: null }).eq("id", BPO01);
  await db.from("close_period").update({ status: "open" }).eq("id", CLOSE);
  await db.from("feature_override").update({ value: true }).eq("flag_key", "bpo.marca_propria");
  await db.from("job").delete().eq("type", "render_close_bpo");
  await db.from("extension_token").delete().eq("account_id", sid("G-02")).neq("id", sid("G-02:ext-pairing"));
});

test("C18_C21_E01_E02_P04_console_as_founder", async ({ page }) => {
  const db = adminDb();
  await loginToConsole(page, FOUNDER_EMAIL);

  // C18 as drawn.
  await page.goto("/console/bpo");
  await expect(page.getByRole("heading", { name: "Parceiros BPO" })).toBeVisible();
  const r1 = page.locator('tr[data-bpo="BPO 01"]');
  await expect(r1).toContainText("2 grupos · 7 lojas");
  await expect(r1).toContainText("arquivos de out chegaram");
  await expect(r1).toContainText("[a definir]");
  const r2 = page.locator('tr[data-bpo="BPO 02"]');
  await expect(r2).toContainText("conversa marcada");
  await expect(r2).toContainText("não criada");
  await expect(page.getByText("Marca do BPO 01 no fechamento")).toBeVisible();
  await expect(page.getByLabel("Cor principal")).toHaveValue("#1351B4");
  await expect(page.getByLabel('Mostrar "com tecnologia MargoAI" no rodapé')).not.toBeChecked();

  // Brand: bad color refused; logo, color and footer saved and audited.
  await page.getByLabel("Cor principal").fill("azul");
  await page.getByRole("button", { name: "Salvar marca" }).click();
  await expect(page.getByRole("status")).toHaveText("Cor no formato #1351B4.");
  await page.locator("#logo").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) });
  await page.getByLabel("Cor principal").fill("#0a7a3d");
  await page.getByLabel('Mostrar "com tecnologia MargoAI" no rodapé').check();
  await page.getByRole("button", { name: "Salvar marca" }).click();
  await expect(page.getByRole("status")).toHaveText("Marca salva.");
  const { data: bpo } = await db.from("bpo_partner").select("primary_color, show_powered_by, logo_path").eq("id", BPO01).single();
  expect(bpo).toEqual({ primary_color: "#0A7A3D", show_powered_by: true, logo_path: `bpo/${BPO01}/logo.svg` });
  const { data: audit } = await db.from("audit_log").select("actor_kind").eq("entity_id", BPO01).eq("action", "bpo_partner.brand");
  expect(audit!.length).toBeGreaterThan(0);

  // "Gerar fechamento com a marca do BPO": nothing until the close is computed; then the branded PDF.
  await page.getByRole("button", { name: "Gerar fechamento com a marca do BPO" }).click();
  await expect(page.getByRole("status")).toHaveText("Nenhum fechamento pronto nos clientes deste BPO.");
  await db.from("close_period").update({ status: "computed" }).eq("id", CLOSE);
  await page.getByRole("button", { name: "Gerar fechamento com a marca do BPO" }).click();
  await expect(page.getByRole("status")).toHaveText("1 fechamento na fila com a marca do BPO 01.");
  runWorker("render_close_bpo");
  await page.reload();
  const link = page.getByRole("link", { name: "baixar PDF" });
  await expect(link).toBeVisible();
  const pdf = await page.request.get((await link.getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // C21: the WhatsApp queue (06 §7); quiet hours hold the owner's message (E05).
  await page.goto("/console/alertas");
  const wa = page.locator(`tr[data-whatsapp="${sid("G-02:wa:deadline")}"]`);
  await expect(wa).toContainText("Dono do grupo · +5543900001234");
  await expect(wa).toContainText("Prazo de contestação chegando");
  if (quiet()) {
    await expect(wa).toContainText("espera até 8h");
    await expect(wa.getByRole("button", { name: /marcar enviada/ })).toHaveCount(0);
  } else {
    await expect(wa.getByRole("link", { name: "abrir no WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/5543900001234\?text=/);
    await wa.getByRole("button", { name: /marcar enviada/ }).click();
    await expect(wa).toHaveCount(0);
    const { data: n } = await db.from("notification").select("status, manual_sent_at").eq("id", sid("G-02:wa:deadline")).single();
    expect(n!.status).toBe("sent");
    expect(n!.manual_sent_at).not.toBeNull();
    await db.from("notification").update({ status: "queued", manual_sent_at: null, manual_sent_by: null, sent_at: null, provider_id: null }).eq("id", sid("G-02:wa:deadline"));
  }

  // "Ver e-mail que o dono recebe" opens E02; E01 next to it.
  await page.getByRole("link", { name: "Ver e-mail que o dono recebe" }).click();
  await expect(page.locator("[data-subject]")).toHaveText("Faltam 3 dias para contestar R$ 640 no iFood");
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "O prazo para contestar o cupom cofinanciado acaba em 15/nov" })).toBeVisible();
  await page.getByRole("link", { name: /E01/ }).click();
  await expect(page.locator("[data-subject]")).toHaveText("Setembro fechado: sobrou R$ 86.800 de R$ 248.000");
  await expect(page.frameLocator("iframe").getByText("SINTÉTICO · dados fictícios")).toBeVisible();

  // P04 from C07: a pairing code for the Grupo Exemplo owner, shown once, stored hashed.
  await page.goto("/console/contas/G-02/importacoes");
  await page.getByRole("link", { name: "Ver a extensão" }).click();
  await expect(page.getByRole("heading", { name: "Extensão do Chrome" })).toBeVisible();
  await page.getByLabel("Para quem").selectOption({ label: "Dono do grupo (Dono)" });
  await page.getByRole("button", { name: "Gerar código" }).click();
  const code = (await page.locator("[data-pairing-code]").textContent())!;
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const { data: rows } = await db.from("extension_token").select("token_hash, created_by").eq("account_id", sid("G-02")).is("paired_at", null);
  expect(JSON.stringify(rows)).not.toContain(code);
  expect(rows!.some((r) => r.created_by === sid("p:marlon"))).toBe(true);
});

test("A05_C18_and_P04_console_pages_answer_404_when_their_flags_are_off", async ({ page }) => {
  await loginToConsole(page, FOUNDER_EMAIL);
  // Grupo C is on the Raio-X plan: m2.extensao_chrome off.
  expect((await page.request.get("/console/contas/G-04/extensao")).status()).toBe(404);
  expect((await page.request.get("/console/contas/G-01/extensao")).status()).toBe(200);
  await adminDb().from("feature_override").update({ value: false }).eq("flag_key", "bpo.marca_propria");
  expect((await page.request.get("/console/bpo")).status()).toBe(404);
  await adminDb().from("feature_override").update({ value: true }).eq("flag_key", "bpo.marca_propria");
  expect((await page.request.get("/console/bpo")).status()).toBe(200);
});
