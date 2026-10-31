// SupabaseBillingStore and the C15 loader on the local stack (G-SYN seed). Writes go to a temporary account
// that is deleted at the end; the seed accounts are only read.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeNotifyStore } from "@/lib/notify/fake-store";
import { adminClient } from "@/lib/supabase/admin";
import { ASAAS_SANDBOX_URL } from "./asaas";
import { FakeAsaasClient } from "./fake-asaas";
import { returnToFree } from "./service";
import { SupabaseBillingStore } from "./supabase-store";
import { loadC15View } from "./view";

const db = adminClient();
const store = new SupabaseBillingStore(db);
const sid = async (code: string) => (await db.from("account").select("id").eq("code", code).single()).data!.id;
const TMP = randomUUID();
const TMP_CODE = `T-${TMP.slice(0, 6)}`;

beforeAll(async () => {
  const lucro = (await db.from("plan").select("id").eq("code", "lucro").single()).data!.id;
  await db.from("account").insert({ id: TMP, name: "Conta de teste", code: TMP_CODE, plan_id: lucro, trial_ends_at: "2026-11-01T23:59:59-03:00", is_synthetic: true });
  const company = (await db.from("company").insert({ account_id: TMP, cnpj: "00000000000000", legal_name: "Teste Ltda" }).select("id").single()).data!.id;
  await db.from("kitchen").insert([
    { account_id: TMP, company_id: company, name: "K1", in_analysis: true },
    { account_id: TMP, company_id: company, name: "K2", in_analysis: false },
  ]);
  await db.from("import_source").insert([
    { account_id: TMP, channel: "ifood", kind: "api" },
    { account_id: TMP, channel: "food99", kind: "upload" },
  ]);
  await db.from("subscription").insert({ account_id: TMP, plan_id: lucro, status: "trial", units_billed: 1 });
});

afterAll(async () => {
  await db.from("audit_log").delete().eq("account_id", TMP);
  await db.from("account").delete().eq("id", TMP);
});

describe("billing store on the local stack", () => {
  it("C15_on_the_seed_matches_the_drawing", async () => {
    const now = new Date("2026-10-30T10:00:00-03:00");
    const v = await loadC15View(db, { baseUrl: ASAAS_SANDBOX_URL, apiKey: null }, now);
    const seed = { ...v, rows: v.rows.filter((r) => /\(G-0[1-4]\)$/.test(r.account)) };
    expect(seed.rows.map((r) => [r.account, r.plan, r.units, r.status, r.next, r.asaas])).toEqual([
      ["Grupo Exemplo (G-02)", "Lucro", "6", "ativa", "05/nov · R$ 1.800", "sub_…a91f"],
      ["Pantanos Burguer (G-01)", "Lucro (teste)", "1", "teste: faltam 9 dias", "sem cartão ainda", "cus_…77c2"],
      ["Grupo B (G-03)", "Lucro (teste)", "3", "teste: faltam 2 dias", "sem cartão ainda", "cus_…0b4e"],
      ["Grupo C (G-04)", "Raio-X", "2", "grátis", "não cobra", ""],
    ]);
    expect(v.kpis.revenue).toBe("R$ 1.800");
    expect(v.kpis.paying).toBe(1);
    expect(v.unit).toBe("loja");
    expect(v.pilots.map((p) => [p.account, p.pct, p.cap])).toEqual([["Grupo B (G-03)", "20%", ""]]);
    expect(v.labels).toEqual(["dados fictícios", "Asaas sandbox"]);
  });

  it("units_count_kitchens_in_analysis_or_their_channel_stores", async () => {
    const g02 = await sid("G-02");
    expect(await store.countUnits(g02, "kitchen")).toBe(2);
    expect(await store.countUnits(g02, "channel_store")).toBe(5);
    expect(await store.countUnits(TMP, "kitchen")).toBe(1);
  });

  it("customer_data_and_asaas_ids", async () => {
    const g01 = await sid("G-01");
    expect(await store.customerData(g01)).toEqual({ name: "Pantanos Burguer Ltda", cnpj: "98765432000150", email: "pantanos@exemplo.com.br" });
    expect(await store.accountByAsaasIds({ customerId: "cus_000000077c2", subscriptionId: null })).toBe(g01);
    expect(await store.accountByAsaasIds({ customerId: null, subscriptionId: "sub_00000000a91f" })).toBe(await sid("G-02"));
    expect(await store.hasActiveLock(g01, new Date())).toBe(false);
  });

  it("E01_billing_event_is_stored_once_and_claimed_once", async () => {
    const eventId = `evt_int_${TMP}`;
    const first = await store.storeEvent({ eventId, asaasEvent: "TEST", kind: "unknown", accountId: TMP, payload: { test: true } });
    expect(first).toMatchObject({ inserted: true, processed: false });
    const again = await store.storeEvent({ eventId, asaasEvent: "TEST", kind: "unknown", accountId: TMP, payload: { test: true } });
    expect(again).toEqual({ id: first.id, inserted: false, processed: false });
    expect(await store.claimEvent(first.id, new Date())).toBe(true);
    expect(await store.claimEvent(first.id, new Date())).toBe(false);
    expect((await store.storeEvent({ eventId, asaasEvent: "TEST", kind: "unknown", accountId: TMP, payload: {} })).processed).toBe(true);
    const { count } = await db.from("billing_event").select("id", { count: "exact", head: true }).eq("asaas_event_id", eventId);
    expect(count).toBe(1);
  });

  it("E02_return_to_free_on_the_database_pauses_sources_and_keeps_data", async () => {
    const now = new Date("2026-11-02T06:00:00-03:00");
    const notify = new FakeNotifyStore();
    await returnToFree({ store, asaas: new FakeAsaasClient(), notify: { store: notify, now: () => now, config: { teamEmail: "x", founderOnDutyEmail: null } }, now: () => now }, TMP, "trial_ended", "fim do teste, voltou ao grátis");
    const sub = await store.subscription(TMP);
    const raioX = (await db.from("plan").select("id").eq("code", "raio_x").single()).data!.id;
    expect(sub).toMatchObject({ status: "free", planId: raioX });
    expect((await db.from("account").select("plan_id").eq("id", TMP).single()).data!.plan_id).toBe(raioX);
    const sources = (await db.from("import_source").select("paused_at, paused_reason").eq("account_id", TMP)).data!;
    expect(sources.map((s) => [s.paused_reason, new Date(s.paused_at!).toISOString()])).toEqual([
      ["trial_ended", now.toISOString()],
      ["trial_ended", now.toISOString()],
    ]);
    // Flags now follow Raio-X: channel imports are off for this account (04 §6, A05).
    const { data: on } = await db.rpc("flag_enabled", { p_key: "m2.arquivo_ifood", p_account: TMP, p_env: "sandbox" });
    expect(on).toBe(false);
    const audits = (await db.from("audit_log").select("action, actor_kind").eq("account_id", TMP).order("at")).data!;
    expect(audits).toEqual([
      { action: "subscription.trial_end", actor_kind: "system" },
      { action: "import_source.pause", actor_kind: "system" },
    ]);
    expect(await store.resumeImportSources(TMP)).toBe(2);
  });
});
