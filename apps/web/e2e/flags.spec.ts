// A05 (07-acceptance): turning a flag off in C20 hides its screen with 404, and every change writes
// feature_flag_log. Wave 0 has no built screen behind a flag, so the screen is the test-only page
// app/teste-e2e/flag/page.e2e.tsx (compiled only for e2e, see next.config.ts). The job side of A05 is
// covered in workers/common (runner flag check).
import { expect, test } from "@playwright/test";
import { FOUNDER_EMAIL, adminDb, loginToConsole } from "./helpers";

const KEY = "m2.contestacao";
const ACCOUNT = "G-02"; // Lucro plan in G-SYN: the flag is on by default.
const PROBE = `/teste-e2e/flag?chave=${KEY}&conta=${ACCOUNT}`;
const REASON = `e2e A05 ${Date.now()}`;

test.describe.configure({ mode: "serial" });

async function ids() {
  const db = adminDb();
  const { data: acc } = await db.from("account").select("id").eq("code", ACCOUNT).single();
  const { data: founder } = await db.from("person").select("id").eq("email", FOUNDER_EMAIL).single();
  return { accountId: acc!.id as string, founderId: founder!.id as string };
}

async function logSince(since: string) {
  const { data, error } = await adminDb()
    .from("feature_flag_log")
    .select("account_id, old, new, by")
    .eq("flag_key", KEY)
    .eq("env", "sandbox")
    .gt("at", since)
    .order("at");
  if (error) throw error;
  return data;
}

/** Newest `at` in the table, so the test reads only the rows it wrote (database clock, not ours). */
async function latest(table: "feature_flag_log" | "audit_log"): Promise<string> {
  const { data } = await adminDb().from(table).select("at").order("at", { ascending: false }).limit(1);
  return (data?.[0]?.at as string | undefined) ?? "1970-01-01T00:00:00Z";
}

// Leave G-SYN as seeded even if a step fails.
test.afterAll(async () => {
  const db = adminDb();
  const { accountId } = await ids();
  await db.from("feature_flag").update({ default_lucro: true }).eq("key", KEY).eq("env", "sandbox");
  await db.from("feature_override").delete().eq("flag_key", KEY).eq("env", "sandbox").eq("account_id", accountId);
});

test("A05_C20_flag_off_hides_its_screen_with_404_and_every_change_writes_feature_flag_log", async ({ page }) => {
  const { accountId, founderId } = await ids();
  const since = await latest("feature_flag_log");
  const auditSince = await latest("audit_log");
  const probe = async () => (await page.request.get(PROBE)).status();

  expect(await probe(), "flag on: the screen renders").toBe(200);

  await loginToConsole(page, FOUNDER_EMAIL);
  await page.goto("/console/funcionalidades");
  await expect(page.getByLabel("Ambiente")).toHaveValue("sandbox");
  const row = page.locator(`tr[data-flag="${KEY}"]`);

  // Plan default off: the screen answers 404 on the next request (no cache, 04 §6).
  await row.getByRole("button", { name: `${KEY} Lucro: ligada` }).click();
  await expect(row.getByRole("button", { name: `${KEY} Lucro: desligada` })).toBeVisible();
  expect(await probe(), "flag off: 404").toBe(404);

  // An account exception turns it back on for G-02 only.
  await row.getByText("Nova exceção").click();
  await row.getByLabel("Conta").selectOption({ label: `${ACCOUNT} · Grupo Exemplo` });
  await row.getByLabel("Valor").selectOption("true");
  await row.getByLabel("Motivo").fill(REASON);
  await row.getByRole("button", { name: "Salvar exceção" }).click();
  await expect(row.locator(`[data-exception="${ACCOUNT}"]`)).toContainText(`${ACCOUNT} ligada: ${REASON}`);
  expect(await probe(), "exception on: 200").toBe(200);

  // Removing the exception hides it again; turning the default back on restores the seed.
  await row.getByRole("button", { name: `remover exceção ${ACCOUNT} de ${KEY}` }).click();
  await expect(row.locator(`[data-exception="${ACCOUNT}"]`)).toHaveCount(0);
  expect(await probe()).toBe(404);
  await row.getByRole("button", { name: `${KEY} Lucro: desligada` }).click();
  await expect(row.getByRole("button", { name: `${KEY} Lucro: ligada` })).toBeVisible();
  expect(await probe()).toBe(200);

  expect(await logSince(since)).toEqual([
    { account_id: null, old: true, new: false, by: founderId },
    { account_id: accountId, old: null, new: true, by: founderId },
    { account_id: accountId, old: true, new: null, by: founderId },
    { account_id: null, old: false, new: true, by: founderId },
  ]);
  const { data: audit } = await adminDb()
    .from("audit_log")
    .select("action")
    .eq("actor_person_id", founderId)
    .like("action", "flag_%")
    .gt("at", auditSince)
    .order("at");
  expect(audit?.map((a) => a.action)).toEqual(["flag_default_set", "flag_exception_set", "flag_exception_removed", "flag_default_set"]);
});

test("A05_C20_unknown_key_on_the_probe_is_404", async ({ page }) => {
  expect((await page.request.get("/teste-e2e/flag?chave=nao.existe")).status()).toBe(404);
});
