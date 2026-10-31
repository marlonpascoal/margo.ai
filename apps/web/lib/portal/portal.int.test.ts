// Owner account screens against the G-SYN seed on the local stack. Rows a test adds are removed after it;
// audit rows stay (append-only, A04).
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { SupabaseJobQueue } from "@/lib/jobs/supabase-queue";
import type { EnqueueDeps } from "@/lib/jobs/enqueue";
import { notifyDeps } from "@/lib/notify/deps";
import { adminClient } from "@/lib/supabase/admin";
import { closeFilePath, exportPath, requestDeletion, requestExport } from "./account-data";
import { loadConnect, signAuthorization, TERMS_VERSION } from "./connect";
import { loadOwnerContestations, markOwnerContestation, ownerTotals } from "./contestacoes";
import { loadLojas } from "./lojas";
import { loadPeople } from "./pessoas";
import type { Scope } from "./scope";

const db = adminClient();
const sid = (tag: string) => {
  const h = createHash("md5").update(`g-syn:${tag}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const G02 = sid("G-02");
const DONO: Scope = { role: "dono", allKitchens: true, kitchenIds: [] };
const GERENTE: Scope = { role: "gerente", allKitchens: false, kitchenIds: [sid("G-02:centro")] };
const META = { ip: "127.0.0.1", userAgent: "vitest" };
const cleanup: (() => PromiseLike<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("A03 on the seed", () => {
  it("A03_lojas_gerente_do_centro_sees_only_centro", async () => {
    const v = await loadLojas(db, G02, GERENTE);
    expect(v.kitchens.map((k) => k.name)).toEqual(["Cozinha Centro"]);
    expect(v.newStores).toEqual([]);
    expect((await loadLojas(db, G02, DONO)).kitchens).toHaveLength(3);
  });

  it("A03_contestacoes_gerente_do_centro_sees_only_centro", async () => {
    const mine = await loadOwnerContestations(db, G02, GERENTE);
    expect(mine.map((r) => r.kitchen)).toEqual(Array(mine.length).fill("Cozinha Centro"));
    expect(mine.length).toBe(4);
    const all = await loadOwnerContestations(db, G02, DONO);
    expect(all.length).toBe(6);
    expect(ownerTotals(all)).toEqual({ toContest: 30_600, inAnalysis: 41_200, back: 23_800, needsAnswer: 14_800 });
  });

  it("A03_pessoas_others_see_only_themselves", async () => {
    const ger = await loadPeople(db, G02, { personId: sid("p:g02-ger"), dono: false });
    expect(ger.rows.map((r) => r.name)).toEqual(["Gerente do Centro"]);
    const dono = await loadPeople(db, G02, { personId: sid("p:g02-dono"), dono: true });
    expect(dono.rows.map((r) => r.name)).toEqual(["Dono do grupo", "Pessoa do financeiro", "Gerente do Centro", "Contador"]);
  });

  it("A03_close_downloads_need_all_kitchens_for_the_account_wide_close", async () => {
    const { data: cp } = await db.from("close_period").select("id").eq("account_id", G02).eq("month", "2026-09-01").single();
    await db.from("close_period").update({ pdf_path: "closes/G-02/2026-09/x.pdf" }).eq("id", cp!.id);
    cleanup.push(() => db.from("close_period").update({ pdf_path: null }).eq("id", cp!.id));
    expect(await closeFilePath(db, G02, DONO, cp!.id, "pdf")).toBe("closes/G-02/2026-09/x.pdf");
    expect(await closeFilePath(db, G02, GERENTE, cp!.id, "pdf")).toBeNull();
    expect(await closeFilePath(db, sid("G-01"), DONO, cp!.id, "pdf")).toBeNull();
  });
});

async function tempContestation(store: string, key: string): Promise<string> {
  const { data: cp } = await db.from("close_period").select("id").eq("account_id", G02).eq("month", "2026-09-01").single();
  const { data: d, error } = await db
    .from("difference")
    .insert({ account_id: G02, close_period_id: cp!.id, channel_store_id: sid(store), rule_id: "DIF-01", finding_key: `teste-${key}-${Date.now()}`, description: "teste", orders_count: 1, amount_cents: 1000, confidence: "certa" })
    .select("id")
    .single();
  if (error) throw error;
  cleanup.push(() => db.from("difference").delete().eq("id", d.id));
  const { data: c, error: e2 } = await db.from("contestation").insert({ account_id: G02, difference_id: d.id, status: "a_contestar", deadline_on: "2026-12-01" }).select("id").single();
  if (e2) throw e2;
  return c.id;
}

describe("P12/W03 owner marks (04 §3, D30)", () => {
  it("C04_owner_marks_through_contestation_mark_and_never_sets_creditada", async () => {
    const id = await tempContestation("G-02:s1", "centro");
    const ger = sid("p:g02-ger");
    expect(await markOwnerContestation(db, G02, GERENTE, ger, id, "credito_encontrado", null, META)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await markOwnerContestation(db, G02, GERENTE, ger, id, "foi_negada", null, META)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await markOwnerContestation(db, G02, GERENTE, ger, id, "ja_contestei", " 777 ", META)).toEqual({ ok: true });
    const { data: c } = await db.from("contestation").select("status, protocol, marked_by, marked_by_kind").eq("id", id).single();
    expect(c).toEqual({ status: "contestada", protocol: "777", marked_by: ger, marked_by_kind: "person" });
    const { data: a } = await db.from("audit_log").select("actor_kind, action, ip, user_agent").eq("entity_id", id).single();
    expect(a).toEqual({ actor_kind: "person", action: "contestation.ja_contestei", ip: "127.0.0.1", user_agent: "vitest" });
  });

  it("A03_gerente_cannot_mark_a_contestation_of_another_kitchen", async () => {
    const id = await tempContestation("G-02:s4", "zonasul");
    expect(await markOwnerContestation(db, G02, GERENTE, sid("p:g02-ger"), id, "ja_contestei", null, META)).toEqual({ ok: false, reason: "not_found" });
    expect(await markOwnerContestation(db, sid("G-01"), DONO, sid("p:g01-dono"), id, "ja_contestei", null, META)).toEqual({ ok: false, reason: "not_found" });
    const { data: c } = await db.from("contestation").select("status").eq("id", id).single();
    expect(c!.status).toBe("a_contestar");
  });
});

// On Pantanos (G-01): audit rows written here stay, and G-02's access log is counted by the seed test.
describe("P03/W07 authorization (C06)", () => {
  it("C06_portal_signs_one_authorization_per_pending_cnpj_with_terms_version", async () => {
    const G01 = sid("G-01");
    const cnpj = sid("G-01:cnpj");
    const { data: old } = await db.from("owner_authorization").select("*").eq("account_id", G01).eq("company_id", cnpj).single();
    await db.from("owner_authorization").delete().eq("id", old!.id);
    cleanup.push(() => db.from("owner_authorization").insert(old!));
    expect((await loadConnect(db, G01)).pending.map((c) => c.id)).toEqual([cnpj]);

    const written = await signAuthorization(db, { personId: sid("p:g01-dono"), accountId: G01 }, [cnpj, sid("G-02:cnpj1")], META);
    cleanup.push(() => db.from("owner_authorization").delete().in("id", written));
    expect(written).toHaveLength(1);
    const { data: row } = await db.from("owner_authorization").select("company_id, signed_by, includes_ai, includes_international, terms_version").eq("id", written[0]).single();
    expect(row).toEqual({ company_id: cnpj, signed_by: sid("p:g01-dono"), includes_ai: true, includes_international: true, terms_version: TERMS_VERSION });
    const { data: a } = await db.from("audit_log").select("action, actor_kind").eq("entity_id", written[0]).single();
    expect(a).toEqual({ action: "owner_authorization.sign", actor_kind: "person" });
    expect((await loadConnect(db, G01)).pending).toEqual([]);
    // G-02's CNPJs are already signed and belong to another account: nothing written for them.
    expect((await loadConnect(db, G02)).pending).toEqual([]);
  });
});

describe("E06 from the portal", () => {
  const deps: EnqueueDeps = { queue: new SupabaseJobQueue(db), agentUrl: () => null, signingKey: () => "x", wake: async () => {}, now: () => new Date() };
  // Grupo B (G-03), so G-02's access log stays as seeded.
  const G03 = sid("G-03");
  const who = { personId: sid("p:g03-dono"), personName: "Dono do Grupo B", accountId: G03, accountName: "Grupo B", meta: META };

  it("E06_export_is_queued_audited_and_served_only_when_done_for_its_account", async () => {
    const jobId = await requestExport(db, deps, who);
    cleanup.push(() => db.from("job").delete().eq("id", jobId));
    const { data: j } = await db.from("job").select("type, account_id, payload, status").eq("id", jobId).single();
    expect(j).toEqual({ type: "account_export", account_id: G03, payload: { account_id: G03, requested_by: who.personId }, status: "queued" });
    expect(await exportPath(db, G03, jobId)).toBeNull();
    await db.from("job").update({ status: "done", log: [{ event: "done", path: `exports/G-03/${jobId}.zip` }] }).eq("id", jobId);
    expect(await exportPath(db, G03, jobId)).toBe(`exports/G-03/${jobId}.zip`);
    expect(await exportPath(db, G02, jobId)).toBeNull();
    const { count } = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("entity_id", jobId).eq("action", "account.export_requested");
    expect(count).toBe(1);
  });

  it("E06_deletion_is_queued_without_account_and_confirmed_by_e_mail", async () => {
    const since = new Date().toISOString();
    const jobId = await requestDeletion(db, { enqueue: deps, notify: notifyDeps() }, who);
    cleanup.push(() => db.from("job").delete().eq("id", jobId));
    cleanup.push(() => db.from("notification").delete().eq("notice_code", "security_event").gte("created_at", since));
    const { data: j } = await db.from("job").select("type, account_id, payload").eq("id", jobId).single();
    expect(j).toEqual({ type: "account_delete", account_id: null, payload: { account_id: G03, requested_by: who.personId } });
    const { data: n } = await db.from("notification").select("person_id, channel, subject").eq("notice_code", "security_event").gte("created_at", since);
    expect(n).toEqual(expect.arrayContaining([{ person_id: sid("p:g03-dono"), channel: "email", subject: "Pedido de exclusão da conta" }]));
  });
});
