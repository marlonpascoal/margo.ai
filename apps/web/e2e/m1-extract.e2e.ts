// B01 from extraction copies (docs/extract-api.md, D47b): C02 creates the X-ray, the collect job queues the
// discovery, an extractor answers over /api/extract with SINTÉTICO fixtures, the neighborhood builds from the
// applied copies, the captures follow, and pairing runs on the captured items. The street address reaches no
// screen. The fixtures' ids and coordinates get a tag per run, since copies are never deleted.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_FAKE_SECRETS } from "./fake-secrets";
import { adminDb, FOUNDER_EMAIL, loginToConsole, ROOT, runWorker } from "./helpers";

const tag = randomBytes(4).toString("hex");
const shift = (parseInt(tag.slice(0, 4), 16) % 3000) / 10 - 150;
const headers = { authorization: `Bearer ${E2E_FAKE_SECRETS.MARGO_EXTRACT_TOKEN}` };

type Store = { lng?: number; url: string };

function fixture(name: string) {
  const text = readFileSync(path.join(ROOT, "fixtures/m1/extract", name), "utf8").replaceAll("5e000000-0000-4000", `${tag}-0000-4000`);
  const body = JSON.parse(text) as { job_id?: string; discover?: { target: Store; stores: Store[] }; capture?: { store: Store } };
  for (const s of [body.discover?.target, ...(body.discover?.stores ?? []), body.capture?.store]) {
    if (s?.lng !== undefined) s.lng = Math.round((s.lng + shift) * 1e6) / 1e6;
  }
  return body;
}

async function claim(request: APIRequestContext) {
  const res = await request.post("/api/extract/claim", { headers, data: { worker: "e2e" } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { job_id: string; kind: string; payload: Record<string, unknown> };
}

async function answer(request: APIRequestContext, jobId: string, name: string) {
  const res = await request.post("/api/extract/result", { headers, data: { ...fixture(name), job_id: jobId } });
  expect(res.status()).toBe(200);
}

const clearQueue = () => adminDb().from("job").delete().in("type", ["extract_discover", "extract_capture", "xray_neighborhood"]);

test.beforeAll(async () => void (await clearQueue()));
test.afterAll(async () => {
  const db = adminDb();
  await clearQueue();
  const { data: person } = await db.from("person").select("id").eq("email", FOUNDER_EMAIL).single();
  const { data: xs } = await db.from("xray").select("id").is("account_id", null).eq("created_by", person!.id);
  for (const x of xs ?? []) {
    await db.from("job").delete().eq("payload->>xray_id", x.id);
    await db.from("xray").delete().eq("id", x.id);
  }
});

test("B01_C02_to_C04_from_extraction_copies", async ({ page, request }) => {
  const db = adminDb();
  await loginToConsole(page, FOUNDER_EMAIL);
  const url = fixture("discover.json").discover!.target.url;

  await page.goto("/console/raio-x/novo");
  await page.getByLabel("Link da loja no iFood").fill(url);
  await page.getByRole("button", { name: "Buscar vizinhança" }).click();
  await page.waitForURL(/\/console\/raio-x\/[0-9a-f-]{36}\/vizinhanca$/);
  const xrayId = page.url().split("/").at(-2)!;
  runWorker("collect");

  // No work for an unauthorized caller; the discovery goes to whoever holds the token.
  expect((await request.post("/api/extract/claim", { data: { worker: "e2e" } })).status()).toBe(401);
  const discover = await claim(request);
  expect(discover.kind).toBe("discover");
  expect(discover.payload).toEqual({ url, radius_km: 3, categories: ["Lanches", "Hambúrguer", "Porções"] });
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Buscando as lojas da vizinhança.");

  await answer(request, discover.job_id, "discover.json");
  runWorker("xray_neighborhood");

  await page.reload();
  const row = (name: string) => page.locator(`li[data-store="${name}"]`);
  await expect(row("Vizinha A Sintética")).toContainText("1,2 km");
  await expect(row("Vizinha A Sintética")).toContainText("no conjunto");
  await expect(row("Vizinha B Sintética")).toContainText("regra: outra categoria");
  await expect(row("Vizinha Longe Sintética")).toHaveCount(0);
  await expect(page.getByText("Capturando os cardápios: faltam 2 lojas.")).toBeVisible();

  await answer(request, (await claim(request)).job_id, "capture-target.json");
  await answer(request, (await claim(request)).job_id, "capture-store.json");
  expect((await request.post("/api/extract/claim", { headers, data: { worker: "e2e" } })).status()).toBe(204);
  runWorker("xray_neighborhood");

  await page.reload();
  await expect(page.getByText("Capturando os cardápios")).toHaveCount(0);
  expect(await page.content()).not.toContain("Sintética, 100");
  expect(await page.content()).not.toContain("Avenida Sintética");

  await page.getByRole("button", { name: "Confirmar 1 loja" }).click();
  await page.waitForURL(`**/console/raio-x/${xrayId}/pareamento`);
  runWorker("xray_pair");
  await page.reload();
  await expect(page.getByText("Hambúrguer sintético").first()).toBeVisible();
  expect(await page.content()).not.toContain("Sintética, 100");

  const { data: items } = await db.from("xray_item").select("id").eq("xray_id", xrayId);
  expect(items).toHaveLength(2);
});
