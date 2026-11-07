// B01 on the local stack: /api/extract/* and /api/cron/extract through their route handlers, with SINTÉTICO
// fixtures whose ids get a tag per run, since copies are never deleted. No external call.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as cron } from "@/app/api/cron/extract/route";
import { POST as claim } from "@/app/api/extract/claim/route";
import { POST as fail } from "@/app/api/extract/fail/route";
import { POST as result } from "@/app/api/extract/result/route";
import { FAIL_REASONS } from "@/lib/extract/contract";
import { adminClient } from "@/lib/supabase/admin";

const TOKEN = "dummy-int-extract-token";
const db = adminClient();
const tag = randomBytes(4).toString("hex");
const ids = (s: string) => s.replaceAll("5e000000-0000-4000", `${tag}-0000-4000`);
const fixture = (name: string) => JSON.parse(ids(readFileSync(resolve(__dirname, "../../../../fixtures/m1/extract", name), "utf8")));
const TARGET = `${tag}-0000-4000-8000-000000000001`;
const STORE_A = `${tag}-0000-4000-8000-000000000002`;
const TARGET_URL = fixture("discover.json").discover.target.url as string;

const post = (route: (r: Request) => Promise<Response>, body: unknown, token: string | null = TOKEN) =>
  route(new Request("http://localhost/api/extract", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

async function clearQueue() {
  const del = await db.from("job").delete().in("type", ["extract_discover", "extract_capture", "xray_neighborhood"]);
  expect(del.error).toBeNull();
}

async function founder(): Promise<string> {
  const { data } = await db.from("person").select("id").eq("email", "marlon@margoai.com").single();
  return data!.id;
}

/** A lead X-ray on the fixture's target, and its discovery in the queue. */
async function newXray(): Promise<string> {
  const x = await db.rpc("xray_create", {
    p_external_id: TARGET, p_url: TARGET_URL, p_radius_km: 3, p_categories: ["Lanches"], p_rules: {}, p_actor: await founder(),
  });
  expect(x.error).toBeNull();
  const q = await db.rpc("extract_queue_discover", { p_xray: x.data as string, p_env: "sandbox" });
  expect(q.error).toBeNull();
  return x.data as string;
}

async function storeRow(external: string) {
  const { data } = await db.from("public_store").select("*").eq("external_id", external).single();
  return data!;
}

beforeAll(() => {
  process.env.MARGO_EXTRACT_TOKEN = TOKEN;
  process.env.CRON_SECRET = "dummy-int-cron";
  process.env.MARGO_ENV = "local";
});
afterAll(clearQueue);
beforeEach(clearQueue);

describe("B01 auth and limits", () => {
  it("B01_bad_token_401_and_missing_env_refuses_everything", async () => {
    expect((await post(claim, { worker: "w" }, "errado")).status).toBe(401);
    expect((await post(claim, { worker: "w" }, null)).status).toBe(401);
    delete process.env.MARGO_EXTRACT_TOKEN;
    expect((await post(claim, { worker: "w" })).status).toBe(401);
    expect((await post(result, { job_id: TARGET })).status).toBe(401);
    expect((await post(fail, { job_id: TARGET, reason: "other" })).status).toBe(401);
    process.env.MARGO_EXTRACT_TOKEN = TOKEN;
  });

  it("B01_body_over_4_mb_is_413", async () => {
    const res = await post(result, JSON.stringify({ job_id: TARGET, pad: "x".repeat(4 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });

  it("B01_claim_needs_a_worker_name", async () => {
    expect((await post(claim, {})).status).toBe(422);
    expect((await post(claim, "não é json")).status).toBe(422);
  });
});

describe("B01 claim", () => {
  it("B01_204_when_there_is_no_work", async () => {
    const res = await post(claim, { worker: "w" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("B01_claim_gives_the_contract_payload_and_runs_up_to_the_limit", async () => {
    // The limit logic, whatever the ceiling is today.
    await db.from("rule_param").update({ value: 3 }).eq("key", "m1.extract_max_running");
    try {
    const x = await newXray();
    const res = await post(claim, { worker: "w-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["job_id", "kind", "payload"]);
    expect(body.kind).toBe("discover");
    expect(body.payload).toEqual({ url: TARGET_URL, radius_km: 3, categories: ["Lanches"] });
    const { data: run } = await db.from("extract_run").select("worker, status, kind").eq("job_id", body.job_id).single();
    expect(run).toEqual({ worker: "w-1", status: "running", kind: "discover" });
    const { data: job } = await db.from("job").select("status").eq("id", body.job_id).single();
    expect(job!.status).toBe("running");
    for (const u of ["a", "b", "c"]) await db.from("job").insert({ type: "extract_capture", payload: { url: `https://exemplo.test/${u}` } });
    expect((await post(claim, { worker: "w-2" })).status).toBe(200);
    expect((await post(claim, { worker: "w-3" })).status).toBe(200);
    expect((await post(claim, { worker: "w-4" })).status).toBe(204);
    await db.from("xray").delete().eq("id", x);
    } finally {
      await db.from("rule_param").update({ value: 20 }).eq("key", "m1.extract_max_running");
    }
  });

  it("B01_A08_a_stuck_job_is_an_attempt_and_fails_with_an_alert_after_the_last", async () => {
    const x = await newXray();
    const first = await (await post(claim, { worker: "w" })).json();
    const stale = new Date(Date.now() - 31 * 60_000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    await db.from("job").update({ claimed_at: stale }).eq("id", first.job_id);
    expect((await post(claim, { worker: "w" })).status).toBe(204);
    const { data: waiting } = await db.from("job").select("status, not_before").eq("id", first.job_id).single();
    expect(waiting!.status).toBe("queued");
    expect(new Date(waiting!.not_before!).getTime()).toBeGreaterThan(Date.now());
    await db.from("job").update({ not_before: past }).eq("id", first.job_id);
    const again = await (await post(claim, { worker: "w" })).json();
    expect(again.job_id).toBe(first.job_id);
    const { data: runs } = await db.from("extract_run").select("status, error").eq("job_id", first.job_id).order("started_at");
    expect(runs).toEqual([{ status: "failed", error: "stuck" }, { status: "running", error: null }]);
    await db.from("job").update({ claimed_at: stale }).eq("id", first.job_id);
    expect((await post(claim, { worker: "w" })).status).toBe(204);
    await db.from("job").update({ not_before: past }).eq("id", first.job_id);
    expect((await (await post(claim, { worker: "w" })).json()).job_id).toBe(first.job_id);
    await db.from("job").update({ claimed_at: stale }).eq("id", first.job_id);
    expect((await post(claim, { worker: "w" })).status).toBe(204);
    const { data: job } = await db.from("job").select("status, attempts").eq("id", first.job_id).single();
    expect(job).toEqual({ status: "failed", attempts: 3 });
    expect((await post(result, fixtureFor("discover.json", first.job_id))).status).toBe(409);
    const { data: alerts } = await db.from("alert").select("id").like("title", "Tarefa extract_discover travou na última tentativa%");
    expect(alerts!.length).toBeGreaterThan(0);
    await db.from("alert").delete().like("title", "Tarefa extract_discover travou%");
    await db.from("xray").delete().eq("id", x);
  });

  it("B01_A05_a_job_whose_flag_is_off_refuses_to_run", async () => {
    const { data: acc } = await db.from("account").select("id").eq("code", "G-01").single();
    await db.from("feature_override").insert({ flag_key: "m1.extracao", env: "sandbox", account_id: acc!.id, value: false, reason: "teste" });
    const j = await db.from("job").insert({ type: "extract_capture", payload: { url: "https://exemplo.test/off" }, account_id: acc!.id }).select("id").single();
    expect((await post(claim, { worker: "w" })).status).toBe(204);
    const { data: job } = await db.from("job").select("status, log").eq("id", j.data!.id).single();
    expect(job!.status).toBe("failed");
    expect((job!.log as { reason?: string }[]).at(-1)?.reason).toBe("flag_off");
    await db.from("feature_override").delete().eq("flag_key", "m1.extracao").eq("account_id", acc!.id);
  });
});

const fixtureFor = (name: string, jobId: string) => ({ ...fixture(name), job_id: jobId });

describe("B01 result", () => {
  it("B01_discover_writes_copies_applies_them_and_is_idempotent", async () => {
    const x = await newXray();
    const { job_id: jobId } = await (await post(claim, { worker: "w" })).json();
    const res = await post(result, fixtureFor("discover.json", jobId));
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("Sintética, 100");
    expect(JSON.parse(raw)).toEqual({
      ok: true,
      copies: 4,
      dropped: ["_label", "discover.stores[].last_seen_open_at", "discover.stores[].raw_html", "discover.stores[].reviews"],
    });

    const target = await storeRow(TARGET);
    expect(target).toMatchObject({ name: "Alvo Sintético", slug: "cidade-sintetica-pr/alvo-sintetico", main_category_code: "LAN", super_categories: ["RESTAURANT"], rating_count: 120 });
    expect(target).not.toHaveProperty("address");
    expect(target.last_seen_open_at).toBe("2026-10-31T13:00:00+00:00");
    const neighbor = await storeRow(STORE_A);
    expect(neighbor.lat).toBeNull();
    expect(neighbor.last_seen_open_at).toBeNull();
    const { data: priv } = await db.from("public_store_private").select("address").eq("public_store_id", target.id).single();
    expect(priv!.address).toBe("Rua Sintética, 100");

    const { data: run } = await db.from("extract_run").select("status, source, copies, finished_at").eq("job_id", jobId).single();
    expect(run).toMatchObject({ status: "done", source: "scraper", copies: 4 });
    const { data: copies } = await db.from("extract_copy").select("store_external_id, collected_at, extract_run!inner(job_id)").eq("extract_run.job_id", jobId);
    expect(copies).toHaveLength(4);
    const { data: xr } = await db.from("xray").select("collected_at").eq("id", x).single();
    expect(xr!.collected_at).toBe("2026-10-31T13:00:00+00:00");
    const { data: next } = await db.from("job").select("payload, status").eq("type", "xray_neighborhood").eq("payload->>xray_id", x);
    expect(next).toEqual([{ status: "queued", payload: { xray_id: x, queue_captures: true } }]);

    const repeat = await post(result, fixtureFor("discover.json", jobId));
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ ok: true, copies: 4, dropped: [] });
    const { count } = await db.from("extract_copy").select("id, extract_run!inner(job_id)", { count: "exact", head: true }).eq("extract_run.job_id", jobId);
    expect(count).toBe(4);

    const discovery = await db.rpc("xray_discovery", { p_xray: x });
    const row = discovery.data!.find((d) => d.public_store_id === neighbor.id);
    expect(row).toMatchObject({ distance_m: 1200, terms: ["Lanches", "HAMBURGUERES"] });
    expect(JSON.stringify(discovery.data)).not.toContain("Sintética, 100");
    await db.from("xray").delete().eq("id", x);
  });

  it("B01_identical_content_is_reused_and_a_new_copy_is_dated", async () => {
    await db.from("job").insert({ type: "extract_capture", payload: { url: "u", channel: "ifood", external_id: STORE_A } });
    const a = await (await post(claim, { worker: "w" })).json();
    expect((await post(result, fixtureFor("capture-store.json", a.job_id))).status).toBe(200);
    await db.from("job").insert({ type: "extract_capture", payload: { url: "u", channel: "ifood", external_id: STORE_A } });
    const b = await (await post(claim, { worker: "w" })).json();
    expect((await post(result, { ...fixtureFor("capture-store.json", b.job_id), collected_at: "2026-11-01T10:10:00-03:00" })).status).toBe(200);
    const { data } = await db.from("extract_copy").select("content_hash, collected_at").eq("store_external_id", STORE_A).order("collected_at");
    const sameContent = data!.slice(-2);
    expect(sameContent[0].content_hash).toBe(sameContent[1].content_hash);
    expect(sameContent[0].collected_at).not.toBe(sameContent[1].collected_at);
  });

  it("B01_M1_05_capture_stores_prices_and_a_newer_capture_marks_removed", async () => {
    await db.from("job").insert({ type: "extract_capture", payload: { url: "u", channel: "ifood", external_id: STORE_A } });
    const a = await (await post(claim, { worker: "w" })).json();
    const first = await post(result, fixtureFor("capture-store.json", a.job_id));
    expect(await first.json()).toEqual({ ok: true, copies: 1, dropped: ["_label"] });
    const store = await storeRow(STORE_A);
    expect(Number(store.lat)).toBe(-9.99);
    const items = async () => (await db.from("public_menu_item").select("external_item_id, price_cents, original_price_cents, minimum_price_cents, comparison_price_cents, removed_at").eq("public_store_id", store.id).order("external_item_id")).data!;
    expect((await items()).map((i) => [i.external_item_id, i.comparison_price_cents, i.original_price_cents, i.removed_at])).toEqual([
      ["item-a-1", 2800, 3200, null],
      ["item-a-2", 1900, null, null],
      ["item-a-3", 900, null, null],
    ]);
    await db.from("job").insert({ type: "extract_capture", payload: { url: "u", channel: "ifood", external_id: STORE_A } });
    const b = await (await post(claim, { worker: "w" })).json();
    expect((await post(result, fixtureFor("capture-store-newer.json", b.job_id))).status).toBe(200);
    expect((await items()).map((i) => [i.external_item_id, i.price_cents, i.removed_at])).toEqual([
      ["item-a-1", 3000, null],
      ["item-a-2", 0, null],
      ["item-a-3", 900, "2026-11-07T11:00:00+00:00"],
    ]);
  });

  it("B01_422_lists_errors_and_the_job_stays_running", async () => {
    await db.from("job").insert({ type: "extract_capture", payload: { url: "u", channel: "ifood", external_id: STORE_A } });
    const a = await (await post(claim, { worker: "w" })).json();
    const body = fixtureFor("capture-store.json", a.job_id);
    delete body.capture.items[0].price_cents;
    const res = await post(result, body);
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual(["capture.items[0].price_cents: required"]);
    const { data: job } = await db.from("job").select("status").eq("id", a.job_id).single();
    expect(job!.status).toBe("running");
  });

  it("B01_404_for_an_unknown_job_and_409_for_one_not_running", async () => {
    expect((await post(result, fixtureFor("capture-store.json", "11111111-0000-4000-8000-000000000000"))).status).toBe(404);
    expect((await post(result, fixtureFor("capture-store.json", "nem-uuid"))).status).toBe(404);
    const other = await db.from("job").insert({ type: "ping", status: "running" }).select("id").single();
    expect((await post(result, fixtureFor("capture-store.json", other.data!.id))).status).toBe(404);
    await db.from("job").delete().eq("id", other.data!.id);
    const q = await db.from("job").insert({ type: "extract_capture", payload: { url: "u", external_id: STORE_A } }).select("id").single();
    expect((await post(result, fixtureFor("capture-store.json", q.data!.id))).status).toBe(409);
    expect((await post(fail, { job_id: q.data!.id, reason: "other" })).status).toBe(409);
  });
});

describe("B01 fail", () => {
  it("B01_fail_records_the_reason_and_closes_the_job_on_a_permanent_reason", async () => {
    const x = await newXray();
    const { job_id: jobId } = await (await post(claim, { worker: "w" })).json();
    expect((await post(fail, { job_id: jobId, reason: "bloqueado" })).status).toBe(422);
    const res = await post(fail, { job_id: jobId, reason: "not_found", detail: "404 na página" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { data: run } = await db.from("extract_run").select("status, error").eq("job_id", jobId).single();
    expect(run).toEqual({ status: "failed", error: "not_found: 404 na página" });
    const { data: job } = await db.from("job").select("status, log").eq("id", jobId).single();
    expect(job!.status).toBe("failed");
    expect(JSON.stringify(job!.log)).not.toContain("404 na página");
    expect((job!.log as { reason?: string }[]).at(-1)?.reason).toBe("not_found");
    expect((await post(fail, { job_id: jobId, reason: "other" })).status).toBe(409);
    expect((await post(result, fixtureFor("discover.json", jobId))).status).toBe(409);
    await db.from("xray").delete().eq("id", x);
  });

  it("B01_fail_with_a_transitory_reason_requeues_the_same_job_for_later", async () => {
    const x = await newXray();
    const { job_id: jobId } = await (await post(claim, { worker: "w" })).json();
    const res = await post(fail, { job_id: jobId, reason: "network", detail: "ECONNRESET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { data: job } = await db.from("job").select("status, attempts, not_before").eq("id", jobId).single();
    expect(job!.status).toBe("queued");
    expect(job!.attempts).toBe(1);
    expect(new Date(job!.not_before!).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect((await post(claim, { worker: "w" })).status).toBe(204);
    expect((await post(fail, { job_id: jobId, reason: "other" })).status).toBe(409);
    expect((await post(result, fixtureFor("discover.json", jobId))).status).toBe(409);
    await db.from("job").update({ not_before: new Date(Date.now() - 1000).toISOString() }).eq("id", jobId);
    expect((await (await post(claim, { worker: "w" })).json()).job_id).toBe(jobId);
    expect((await post(result, fixtureFor("discover.json", jobId))).status).toBe(200);
    const { data: runs } = await db.from("extract_run").select("status").eq("job_id", jobId).order("started_at");
    expect(runs!.map((r) => r.status)).toEqual(["failed", "done"]);
    await db.from("xray").delete().eq("id", x);
  });

  it("B01_every_fail_reason_is_classed_in_rule_param_and_nothing_else", async () => {
    const { data } = await db.from("rule_param").select("key, value").like("key", "m1.extract_retry_reason_%");
    const classed = Object.fromEntries(data!.map((r) => [r.key.replace("m1.extract_retry_reason_", ""), Number(r.value)]));
    expect(classed).toEqual({ blocked: 1, timeout: 1, network: 1, stuck: 1, not_found: 0, parse_error: 0, other: 0 });
    expect(Object.keys(classed).filter((k) => k !== "stuck").sort()).toEqual([...FAIL_REASONS].sort());
  });
});

describe("B01 cron", () => {
  const get = (token?: string) => cron(new Request("http://localhost/api/cron/extract", { headers: token ? { authorization: `Bearer ${token}` } : {} }) as unknown as NextRequest);

  it("B01_cron_needs_its_secret_and_queues_each_store_once", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("errado")).status).toBe(401);
    const x = await newXray();
    await db.from("job").delete().eq("type", "extract_discover");
    const first = await get("dummy-int-cron");
    expect(first.status).toBe(200);
    expect((await first.json()).queued).toBeGreaterThan(0);
    const target = await storeRow(TARGET);
    const { data: jobs } = await db.from("job").select("dedupe_key, status").eq("type", "extract_capture").eq("payload->>public_store_id", target.id);
    expect(jobs).toEqual([{ dedupe_key: `extract_capture:${target.id}`, status: "queued" }]);
    expect(await (await get("dummy-int-cron")).json()).toEqual({ ok: true, queued: 0 });
    await db.from("xray").delete().eq("id", x);
  });
});
