// P04 endpoints against the local stack (06 §9): pairing, token auth, flag off (A05), C06, size and type limits,
// audit (A04), and an extension upload going through the existing import with dedupe (C01, D31).
// Calls the route handlers directly. Creates and deletes its own accounts; restores what it touches in G-02.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as pairRoute } from "@/app/api/extension/pair/route";
import { GET as statusRoute } from "@/app/api/extension/status/route";
import { POST as uploadRoute } from "@/app/api/extension/upload/route";
import { POST as legacyUploadRoute } from "@/app/api/ext/upload/route";
import { adminClient } from "@/lib/supabase/admin";
import { sha256Hex, UPLOAD_MESSAGES } from "./core";
import { createPairingCode, revokeExtensionToken } from "./server";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const FIXTURE = path.join(ROOT, "fixtures/m2/ifood-conciliacao-set2026-SINTETICO.csv");
const db = adminClient();
const tag = randomBytes(4).toString("hex");
const meta = { ip: "203.0.113.5", userAgent: "vitest" };
const URL_BASE = "http://localhost/api/extension";
const sid = (t: string) => {
  const h = createHash("md5").update(`g-syn:${t}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const accounts: string[] = [];
const people: string[] = [];
const created = { g02Runs: [] as string[], g02Tokens: [] as string[] };
let g02ExtOk: string | null = null;

async function makeAccount(plan: "lucro" | "raio_x", synthetic: boolean, suffix = "") {
  const { data: p } = await db.from("plan").select("id").eq("code", plan).single();
  const acc = await db.from("account").insert({ name: `Conta extensão ${plan}`, code: `T-EXT-${plan}-${synthetic ? "s" : "r"}${suffix}-${tag}`, is_synthetic: synthetic, plan_id: p!.id }).select("id").single();
  const accountId = acc.data!.id;
  accounts.push(accountId);
  const person = await db.from("person").insert({ name: "Dono extensão", email: `ext-${plan}-${synthetic}${suffix}-${tag}@teste.local` }).select("id").single();
  people.push(person.data!.id);
  await db.from("membership").insert({ account_id: accountId, person_id: person.data!.id, role: "dono" });
  const company = await db.from("company").insert({ account_id: accountId, cnpj: `9${String(parseInt(tag, 16)).padStart(13, "0").slice(-13)}`, legal_name: "Teste Ltda" }).select("id").single();
  const kitchen = await db.from("kitchen").insert({ account_id: accountId, company_id: company.data!.id, name: "Cozinha teste", in_analysis: true }).select("id").single();
  const store = await db
    .from("channel_store")
    .insert({ account_id: accountId, kitchen_id: kitchen.data!.id, channel: "ifood", external_id: `ext-${plan}-${synthetic}${suffix}-${tag}`, name: "Loja teste", source: "manual" })
    .select("id")
    .single();
  return { accountId, personId: person.data!.id, companyId: company.data!.id, storeId: store.data!.id };
}

async function pairedToken(accountId: string, personId: string): Promise<string> {
  const c = await createPairingCode(db, { personId, accountId, actor: { personId, kind: "person" } }, meta, new Date());
  const res = await pairRoute(new Request(`${URL_BASE}/pair`, { method: "POST", body: JSON.stringify({ code: c!.code.toLowerCase().replace("-", " ") }) }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const status = (token: string | null) => statusRoute(new Request(`${URL_BASE}/status`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

function upload(token: string, file: { name: string; body: Uint8Array | string }, extra: Record<string, string> = {}, route = uploadRoute) {
  const form = new FormData();
  form.set("arquivo", new File([file.body as BlobPart], file.name, { type: "text/csv" }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return route(new Request(`${URL_BASE}/upload`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form }));
}

let lucro: Awaited<ReturnType<typeof makeAccount>>;
let real: Awaited<ReturnType<typeof makeAccount>>;
let raioX: Awaited<ReturnType<typeof makeAccount>>;

beforeAll(async () => {
  lucro = await makeAccount("lucro", true);
  real = await makeAccount("lucro", false);
  raioX = await makeAccount("raio_x", true);
  const src = await db.from("import_source").select("last_ok_at").eq("id", sid("G-02:src:ifood-ext")).single();
  g02ExtOk = src.data!.last_ok_at;
});

afterAll(async () => {
  if (created.g02Runs.length) {
    const { data: runs } = await db.from("import_run").select("job_id").in("id", created.g02Runs);
    await db.from("audit_log").delete().in("entity_id", created.g02Runs);
    await db.from("import_run").delete().in("id", created.g02Runs);
    const jobs = (runs ?? []).map((r) => r.job_id).filter((j): j is string => !!j);
    if (jobs.length) await db.from("job").delete().in("id", jobs);
  }
  if (created.g02Tokens.length) {
    await db.from("audit_log").delete().in("entity_id", created.g02Tokens);
    await db.from("extension_token").delete().in("id", created.g02Tokens);
  }
  await db.from("import_source").update({ last_ok_at: g02ExtOk }).eq("id", sid("G-02:src:ifood-ext"));
  await db.from("job").delete().in("account_id", accounts);
  await db.from("audit_log").delete().in("account_id", accounts);
  await db.from("account").delete().in("id", accounts);
  await db.from("person").delete().in("id", people);
});

describe("P04 pairing and token", () => {
  it("P04_int_code_pairs_once_and_only_the_hash_is_stored", async () => {
    const c = await createPairingCode(db, { personId: lucro.personId, accountId: lucro.accountId, actor: { personId: lucro.personId, kind: "person" } }, meta, new Date());
    const first = await pairRoute(new Request(`${URL_BASE}/pair`, { method: "POST", body: JSON.stringify({ code: c!.code }) }));
    expect(first.status).toBe(200);
    const { token, account } = (await first.json()) as { token: string; account: string };
    expect(account).toBe("Conta extensão lucro");
    const again = await pairRoute(new Request(`${URL_BASE}/pair`, { method: "POST", body: JSON.stringify({ code: c!.code }) }));
    expect(again.status).toBe(404);
    const rows = await db.from("extension_token").select("token_hash, paired_at").eq("account_id", lucro.accountId);
    expect(rows.data).toHaveLength(1);
    expect(rows.data![0].token_hash).toBe(sha256Hex(token));
    expect(JSON.stringify(rows.data)).not.toContain(token);
    const audit = await db.from("audit_log").select("action, actor_kind").eq("account_id", lucro.accountId).like("action", "extension_token.%").order("at");
    expect(audit.data).toEqual([
      { action: "extension_token.code", actor_kind: "person" },
      { action: "extension_token.pair", actor_kind: "person" },
    ]);
  });

  it("P04_int_expired_or_unknown_code_is_refused", async () => {
    const c = await createPairingCode(db, { personId: lucro.personId, accountId: lucro.accountId, actor: { personId: lucro.personId, kind: "person" } }, meta, new Date(Date.now() - 11 * 60_000));
    expect((await pairRoute(new Request(`${URL_BASE}/pair`, { method: "POST", body: JSON.stringify({ code: c!.code }) }))).status).toBe(404);
    expect((await pairRoute(new Request(`${URL_BASE}/pair`, { method: "POST", body: JSON.stringify({ code: "x" }) }))).status).toBe(400);
    expect(await createPairingCode(db, { personId: raioX.personId, accountId: lucro.accountId, actor: { personId: raioX.personId, kind: "person" } }, meta, new Date())).toBeNull();
  });

  it("P04_int_status_with_token_shows_stores_reports_and_last_upload; bad or revoked token is 401", async () => {
    const token = await pairedToken(lucro.accountId, lucro.personId);
    const res = await status(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: { name: string; synthetic: boolean }; stores: { id: string; name: string }[]; reports: { name: string }[]; lastUpload: string | null };
    expect(body.account).toEqual({ name: "Conta extensão lucro", synthetic: true });
    expect(body.stores).toEqual([{ id: lucro.storeId, name: "Loja teste" }]);
    expect(body.reports.map((r) => r.name)).toEqual(["Vendas por item", "Extrato de promoções e campanhas", "Avaliações da loja"]);
    expect(body.lastUpload).toBeNull();

    expect((await status(null)).status).toBe(401);
    expect((await status("mgx_not-a-token")).status).toBe(401);
    const { data: row } = await db.from("extension_token").select("id").eq("token_hash", sha256Hex(token)).single();
    expect(await revokeExtensionToken(db, row!.id, lucro.accountId, { personId: lucro.personId, kind: "person" }, meta, new Date())).toBe(true);
    expect((await status(token)).status).toBe(401);
    expect((await upload(token, { name: "a.csv", body: "x" })).status).toBe(401);
  });

  it("P04_int_seeded_pantanos_token_reads_its_store", async () => {
    const res = await status("g-syn-extensao-pantanos");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: { name: string }; stores: { name: string }[]; lastUpload: string };
    expect(body.account.name).toBe("Pantanos Burguer");
    expect(body.stores.map((s) => s.name)).toEqual(["Pantanos Burguer Igapó"]);
    expect(new Date(body.lastUpload).toISOString()).toBe("2026-10-29T00:14:00.000Z");
  });
});

describe("A05 flag m2.extensao_chrome off", () => {
  it("A05_int_extension_endpoints_answer_404_when_the_flag_is_off", async () => {
    // Raio-X plan: m2.extensao_chrome is off (04 §6). Pair refuses; a token made before still gets 404.
    const c = await createPairingCode(db, { personId: raioX.personId, accountId: raioX.accountId, actor: { personId: raioX.personId, kind: "person" } }, meta, new Date());
    expect((await pairRoute(new Request(`${URL_BASE}/pair`, { method: "POST", body: JSON.stringify({ code: c!.code }) }))).status).toBe(404);
    const token = `mgx_flag_off_${tag}`;
    await db.from("extension_token").insert({ person_id: raioX.personId, account_id: raioX.accountId, token_hash: sha256Hex(token), paired_at: new Date().toISOString() });
    expect((await status(token)).status).toBe(404);
    expect((await upload(token, { name: "a.csv", body: "x" })).status).toBe(404);
    expect((await db.from("import_run").select("id").eq("account_id", raioX.accountId)).data).toEqual([]);
  });
});

describe("C06 and upload limits", () => {
  it("C06_int_real_account_without_owner_authorization_is_refused", async () => {
    const token = await pairedToken(real.accountId, real.personId);
    const refused = await upload(token, { name: "conciliacao.csv", body: "a;b\n1;2\n" }, { loja: real.storeId });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe("Sem autorização do dono para este CNPJ. A importação espera a autorização assinada.");
    expect((await db.from("import_run").select("id").eq("account_id", real.accountId)).data).toEqual([]);

    await db.from("owner_authorization").insert({ account_id: real.accountId, company_id: real.companyId, scope: ["extensao"], includes_ai: false, includes_international: false, signed_by: real.personId, signed_at: new Date().toISOString() });
    const ok = await upload(token, { name: "conciliacao.csv", body: "a;b\n1;2\n" }, { loja: real.storeId });
    expect(ok.status).toBe(201);
  });

  it("P04_int_type_size_and_store_are_checked", async () => {
    const token = await pairedToken(lucro.accountId, lucro.personId);
    expect((await upload(token, { name: "relatorio.pdf", body: "%PDF" })).status).toBe(415);
    expect((await upload(token, { name: "a.csv", body: "x" }, { loja: real.storeId })).status).toBe(400);
    const big = await uploadRoute(new Request(`${URL_BASE}/upload`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": String(30 * 1024 * 1024) }, body: "x" }));
    expect(big.status).toBe(413);
  });
});

describe("E02 paused sources", () => {
  it("E02_int_upload_is_refused_while_the_account_sources_are_paused", async () => {
    const acc = await makeAccount("lucro", true, "-pausa");
    const token = await pairedToken(acc.accountId, acc.personId);
    const csv = { name: "conciliacao.csv", body: "a;b\n1;2\n" };
    // Trial ended with only the upload source: the extension's first upload is refused too.
    await db.from("import_source").insert({ account_id: acc.accountId, channel: "ifood", kind: "upload", paused_at: new Date().toISOString(), paused_reason: "trial_ended" });
    const first = await upload(token, csv);
    expect(first.status).toBe(409);
    expect(((await first.json()) as { error: string }).error).toBe(UPLOAD_MESSAGES.paused);
    expect((await db.from("import_run").select("id").eq("account_id", acc.accountId)).data).toEqual([]);

    // The extension's own source paused: refused; resumed (a plan was chosen): accepted.
    await db.from("import_source").update({ paused_at: null, paused_reason: null }).eq("account_id", acc.accountId);
    await db.from("import_source").insert({ account_id: acc.accountId, channel: "ifood", kind: "extension", paused_at: new Date().toISOString(), paused_reason: "subscription_canceled" });
    expect((await upload(token, csv)).status).toBe(409);
    await db.from("import_source").update({ paused_at: null, paused_reason: null }).eq("account_id", acc.accountId);
    expect((await upload(token, csv)).status).toBe(201);
  });
});

describe("C01 dedupe through the existing import", () => {
  it("C01_int_extension_upload_of_an_already_imported_file_adds_zero_rows", async () => {
    // Grupo Exemplo's owner sends the September iFood export again from the extension (legacy path /api/ext/upload).
    const dono = sid("p:g02-dono");
    const c = await createPairingCode(db, { personId: dono, accountId: sid("G-02"), actor: { personId: dono, kind: "person" } }, meta, new Date());
    const pair = await pairRoute(new Request(`${URL_BASE}/pair`, { method: "POST", body: JSON.stringify({ code: c!.code }) }));
    const { token } = (await pair.json()) as { token: string };
    const { data: tok } = await db.from("extension_token").select("id").eq("token_hash", sha256Hex(token)).single();
    created.g02Tokens.push(tok!.id);
    const before = await db.from("ledger_entry").select("id", { count: "exact", head: true }).eq("account_id", sid("G-02"));

    const res = await upload(token, { name: "ifood-conciliacao-set2026-SINTETICO.csv", body: readFileSync(FIXTURE) }, { relatorio: "vendas_por_item" }, legacyUploadRoute);
    expect(res.status).toBe(201);
    const { importRunId } = (await res.json()) as { importRunId: string };
    created.g02Runs.push(importRunId);

    const run = await db.from("import_run").select("trigger, status, created_by, import_source(kind)").eq("id", importRunId).single();
    expect(run.data).toMatchObject({ trigger: "extension", status: "queued", created_by: dono, import_source: { kind: "extension" } });
    const audit = await db.from("audit_log").select("action, actor_kind, actor_person_id").eq("entity_id", importRunId);
    expect(audit.data).toEqual([{ action: "import_run.extension_upload", actor_kind: "person", actor_person_id: dono }]);

    for (let i = 0; i < 4; i++) {
      execFileSync("uv", ["run", "worker", "import_ifood_file", "--local", "--once"], { cwd: ROOT, stdio: "pipe", timeout: 120_000 });
      const { data } = await db.from("import_run").select("status").eq("id", importRunId).single();
      if (data!.status !== "queued") break;
    }
    const done = await db.from("import_run").select("status, rows_total, rows_new, rows_duplicate").eq("id", importRunId).single();
    expect(done.data).toMatchObject({ status: "ok", rows_new: 0 });
    expect(done.data!.rows_duplicate).toBe(done.data!.rows_total);
    const after = await db.from("ledger_entry").select("id", { count: "exact", head: true }).eq("account_id", sid("G-02"));
    expect(after.count).toBe(before.count);
    const src = await db.from("import_source").select("last_ok_at").eq("id", sid("G-02:src:ifood-ext")).single();
    expect(new Date(src.data!.last_ok_at!).getTime()).toBeGreaterThan(new Date(g02ExtOk!).getTime());
  }, 300_000);
});
