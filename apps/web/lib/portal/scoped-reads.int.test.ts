// A02, A03, D63: the owner portal's reads through a real person's session on the local stack. Two accounts of
// G-SYN: A is G-01 (Pantanos) and B is G-02 (Grupo Exemplo, with a Gerente of Cozinha Centro). Temporary Auth
// users are linked to the seed people for the run; temporary rows go when it ends.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@margoai/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicEnv, serviceRoleKey } from "@/lib/env";
import { loadPlanView } from "@/lib/billing/view";
import { closePeriods } from "@/lib/m2/close";
import { loadDecision } from "@/lib/m3/data";
import { adminClient, type Db } from "@/lib/supabase/admin";
import { accountReader, personReader, type ReadDb, type TableName } from "@/lib/supabase/reader";
import { closeFilePath } from "./account-data";
import { loadConnect } from "./connect";
import { loadOwnerContestations } from "./contestacoes";
import { loadHomeDiffs, loadHomeLines, loadReports, scopeKitchens } from "./home";
import { loadLojas } from "./lojas";
import { loadNoticeRows } from "./notices";
import { loadPeople } from "./pessoas";
import type { Scope } from "./scope";
import { loadAccessLog, loadDevices } from "./security";
import { membershipsOf } from "./session";

const admin = adminClient();
const sid = (tag: string) => {
  const h = createHash("md5").update(`g-syn:${tag}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const A = sid("G-01");
const B = sid("G-02");
const CENTRO = sid("G-02:centro");
const P = { aDono: sid("p:g01-dono"), bDono: sid("p:g02-dono"), bFin: sid("p:g02-fin"), bGer: sid("p:g02-ger"), staff: sid("p:marlon") };
const ALL = (role: Scope["role"]): Scope => ({ role, allKitchens: true, kitchenIds: [] });
const GERENTE: Scope = { role: "gerente", allKitchens: false, kitchenIds: [CENTRO] };

const session: Record<keyof typeof P, Db> = {} as never;
const authIds: string[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];
let accountTables: TableName[] = [];
let closeB = "";

const anonClient = () => createClient<Database>(publicEnv().supabaseUrl, publicEnv().supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** A real Supabase session for a seed person: the JWT PostgREST sees is role authenticated with this user. */
async function signIn(personId: string, tag: string): Promise<Db> {
  const email = `scoped-reads.${tag}@teste.local`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  authIds.push(created.data.user.id);
  const linked = await admin.from("person").update({ auth_user_id: created.data.user.id }).eq("id", personId);
  if (linked.error) throw linked.error;
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const client = anonClient();
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (verified.error) throw verified.error;
  return client as unknown as Db;
}

/** Every public table with an account_id column, from PostgREST's own schema, so a new table is covered. */
async function tablesWithAccountId(): Promise<TableName[]> {
  const res = await fetch(`${publicEnv().supabaseUrl}/rest/v1/`, { headers: { apikey: serviceRoleKey(), authorization: `Bearer ${serviceRoleKey()}`, accept: "application/openapi+json" } });
  const spec = (await res.json()) as { definitions: Record<string, { properties?: Record<string, unknown> }> };
  return Object.entries(spec.definitions)
    .filter(([, d]) => d.properties && "account_id" in d.properties)
    .map(([t]) => t as TableName);
}

/** An unfiltered `select *` of a table named at run time (the typed query cannot take a union of every table). */
const selectAll = (db: ReadDb, table: string) =>
  (db as unknown as { from(t: string): { select(c: string): PromiseLike<{ data: { account_id?: string }[] | null; error: { message: string } | null }> } }).from(table).select("*");

async function rowsOf(db: ReadDb, table: TableName): Promise<{ account_id?: string }[]> {
  const { data, error } = await selectAll(db, table);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

/** Tables where this client got a row of `other`. RLS must leave this empty with no filter in the query. */
async function leaks(db: ReadDb, other: string): Promise<string[]> {
  const out: string[] = [];
  for (const t of accountTables) if ((await rowsOf(db, t)).some((r) => r.account_id === other)) out.push(t);
  const account = await admin.from("account").select("id");
  expect(account.data!.length).toBeGreaterThan(1);
  const seen = await db.from("account").select("id");
  if ((seen.data ?? []).some((a) => a.id === other)) out.push("account");
  return out;
}

const ids = async (db: ReadDb, t: "kitchen" | "channel_store") => {
  const { data, error } = await db.from(t).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id);
};

beforeAll(async () => {
  accountTables = await tablesWithAccountId();
  expect(accountTables.length).toBeGreaterThan(40);
  session.aDono = await signIn(P.aDono, "a-dono");
  session.bDono = await signIn(P.bDono, "b-dono");
  session.bFin = await signIn(P.bFin, "b-fin");
  session.bGer = await signIn(P.bGer, "b-ger");
  session.staff = await signIn(P.staff, "staff");
  const { data: cp } = await admin.from("close_period").select("id").eq("account_id", B).eq("month", "2026-09-01").single();
  closeB = cp!.id;
  // A close of account A, so the other direction has something to find, and an X-ray PDF path for each account.
  const { data: cpA, error } = await admin.from("close_period").insert({ account_id: A, month: "2026-09-01", pdf_path: "closes/G-01/2026-09/x.pdf" }).select("id").single();
  if (error) throw error;
  cleanup.push(() => admin.from("close_period").delete().eq("id", cpA.id));
  const { data: xrayA } = await admin.from("xray").select("id, pdf_path").eq("account_id", A).limit(1).single();
  await admin.from("xray").update({ pdf_path: "pdf/scoped-reads.pdf" }).eq("id", xrayA!.id);
  cleanup.push(() => admin.from("xray").update({ pdf_path: xrayA!.pdf_path }).eq("id", xrayA!.id));
}, 60_000);

afterAll(async () => {
  while (cleanup.length) await cleanup.pop()!();
  await admin.from("person").update({ auth_user_id: null }).in("auth_user_id", authIds);
  for (const id of authIds) await admin.auth.admin.deleteUser(id);
});

describe("A02: RLS alone, with no filter in the query", () => {
  it("A02_the_test_is_not_vacuous_account_B_has_rows_the_service_role_sees", async () => {
    const withRows: string[] = [];
    for (const t of accountTables) if ((await rowsOf(admin, t)).some((r) => r.account_id === B)) withRows.push(t);
    expect(withRows.length).toBeGreaterThan(15);
    for (const t of ["order_fact", "close_line", "difference", "contestation", "invoice", "contribution"]) expect(withRows).toContain(t);
  });

  it("A02_dono_of_A_reads_no_row_of_B_in_any_account_table_and_does_see_own", async () => {
    expect(await leaks(session.aDono, B)).toEqual([]);
    expect((await ids(session.aDono, "kitchen")).length).toBeGreaterThan(0);
  });

  it("A02_each_profile_of_B_reads_no_row_of_A", async () => {
    for (const who of [session.bDono, session.bFin, session.bGer]) expect(await leaks(who, A)).toEqual([]);
    expect((await ids(session.bDono, "kitchen")).length).toBe(3);
  });

  it("A02_tables_without_account_id_stop_at_the_account_too", async () => {
    const { data: people } = await session.aDono.from("person").select("id");
    expect((people ?? []).map((p) => p.id)).toEqual([P.aDono]);
    const mk = await session.aDono.from("membership_kitchen").select("membership_id");
    expect(mk.data).toEqual([]);
    const urls = await session.aDono.from("channel_store_url_history").select("channel_store_id");
    const bStores = new Set(await ids(admin, "channel_store").then(async () => (await admin.from("channel_store").select("id").eq("account_id", B)).data!.map((s) => s.id)));
    expect((urls.data ?? []).filter((u) => bStores.has(u.channel_store_id))).toEqual([]);
    const devices = await session.aDono.from("session_device").select("person_id");
    expect((devices.data ?? []).filter((d) => d.person_id !== P.aDono)).toEqual([]);
  });

  it("A03_gerente_reads_only_stores_of_own_kitchen_with_no_filter", async () => {
    const { data: stores } = await session.bGer.from("channel_store").select("kitchen_id");
    expect(new Set(stores!.map((s) => s.kitchen_id))).toEqual(new Set([CENTRO]));
    expect(await ids(session.bGer, "kitchen")).toEqual([CENTRO]);
    const { data: centroStores } = await admin.from("channel_store").select("id").eq("kitchen_id", CENTRO);
    const own = new Set(centroStores!.map((s) => s.id));
    for (const t of ["close_line", "difference", "close_cost_line", "order_fact", "ledger_entry"] as const) {
      const { data, error } = await session.bGer.from(t).select("channel_store_id");
      expect(error).toBeNull();
      expect((data ?? []).filter((r) => !own.has(r.channel_store_id)), t).toEqual([]);
    }
    expect((await session.bGer.from("xray").select("id")).data).toEqual([]);
    expect((await session.bGer.from("close_period").select("id")).data).toEqual([]);
  });

  it("A02_no_direct_write_with_a_session_and_no_table_access_for_anon", async () => {
    const write = await session.bDono.from("kitchen").update({ name: "mudou" }).eq("account_id", B);
    expect(write.error?.code).toBe("42501");
    const anon = anonClient();
    for (const t of ["plan", "account", "person", "kitchen", "notice_type"] as const) expect((await anon.from(t).select("*")).error?.code, t).toBe("42501");
  });
});

describe("A02: the scoped reader", () => {
  it("A02_deliberately_unfiltered_queries_through_the_reader_bring_no_row_of_B", async () => {
    const reader = accountReader(session.aDono, A);
    expect(await leaks(reader, B)).toEqual([]);
    expect((await ids(reader, "kitchen")).length).toBeGreaterThan(0);
    const direct = accountReader(session.aDono, B);
    expect(await leaks(direct, B)).toEqual([]);
    expect((await direct.from("kitchen").select("id")).data).toEqual([]);
  });

  it("A02_a_person_of_two_accounts_reads_only_the_opened_one", async () => {
    const { data: m, error } = await admin.from("membership").insert({ account_id: A, person_id: P.bDono, role: "financeiro" }).select("id").single();
    if (error) throw error;
    try {
      expect((await membershipsOf(personReader(session.bDono), P.bDono)).map((x) => x.accountId).sort()).toEqual([A, B].sort());
      expect(await leaks(session.bDono, A), "RLS allows both").not.toEqual([]);
      const openedA = accountReader(session.bDono, A);
      expect(await leaks(openedA, B)).toEqual([]);
      const openedB = accountReader(session.bDono, B);
      expect(await leaks(openedB, A)).toEqual([]);
    } finally {
      await admin.from("membership").delete().eq("id", m.id);
    }
  });

  it("A02_a_staff_person_with_a_membership_reads_only_the_opened_account", async () => {
    const { data: m, error } = await admin.from("membership").insert({ account_id: A, person_id: P.staff, role: "financeiro" }).select("id").single();
    if (error) throw error;
    try {
      expect(await leaks(accountReader(session.staff, A), B)).toEqual([]);
    } finally {
      await admin.from("membership").delete().eq("id", m.id);
    }
  });

  it("A02_a_new_table_without_account_id_cannot_slip_through_every_table_answers", async () => {
    const reader = accountReader(session.bDono, B);
    for (const t of [...accountTables, "person", "membership_kitchen", "session_device", "channel_store_url_history", "plan", "notice_type", "rule_param", "ingredient", "account"]) {
      expect((await selectAll(reader, t)).error, t).toBeNull();
    }
  });
});

describe("A02: each portal read as a member of A, pointed at B", () => {
  const member = { allKitchens: true, kitchenIds: [] as string[], account: { id: B } as never };

  it("A02_every_loader_finds_nothing_of_B", async () => {
    const r = accountReader(session.aDono, A);
    const dono = ALL("dono");
    expect(await loadHomeLines(r, closeB, member)).toEqual([]);
    expect(await loadHomeDiffs(r, closeB, member)).toEqual([]);
    expect(await loadDecision(r, closeB, "2026-09-01")).toBeNull();
    expect(await closePeriods(r, B)).toEqual([]);
    expect(await closeFilePath(r, B, dono, closeB, "pdf")).toBeNull();
    expect(await loadReports(r, member)).toEqual([]);
    expect(await scopeKitchens(r, { account: { id: B } as never, kitchenIds: [CENTRO] })).toEqual([]);
    expect(await loadOwnerContestations(r, B, dono)).toEqual([]);
    expect((await loadConnect(r, B)).companies).toEqual([]);
    const lojas = await loadLojas(r, B, dono);
    expect([lojas.kitchens, lojas.stores, lojas.companies]).toEqual([[], 0, 0]);
    const people = await loadPeople(r, B, { personId: P.bDono, dono: true });
    expect(people.rows).toEqual([]);
    expect(people.kitchens).toEqual([]);
    expect(await loadDevices(r, P.bDono, "x")).toEqual([]);
    expect(await loadAccessLog(r, B, P.aDono)).toEqual([]);
    await expect(loadPlanView(r, B, null, new Date())).rejects.toThrow(/no subscription/);
    const prefs = await loadNoticeRows(r, P.bDono, B, "dono");
    expect(prefs.length).toBeGreaterThan(0); // notice defaults only: public reference data, no row of B
  });

  it("A03_gerente_gets_only_own_kitchen_even_if_the_scope_passed_in_lies", async () => {
    const r = accountReader(session.bGer, B);
    const lying = ALL("dono");
    const lojas = await loadLojas(r, B, lying);
    expect(lojas.kitchens.map((k) => k.name)).toEqual(["Cozinha Centro"]);
    expect(lojas.newStores).toEqual([]);
    const c = await loadOwnerContestations(r, B, lying);
    expect(c.map((x) => x.kitchen)).toEqual(Array(c.length).fill("Cozinha Centro"));
    const lines = await loadHomeLines(r, closeB, { allKitchens: true, kitchenIds: [] });
    expect(new Set(lines.map((l) => l.kitchenId))).toEqual(new Set([CENTRO]));
    expect(await closeFilePath(r, B, lying, closeB, "pdf")).toBeNull();
    expect(await loadDecision(r, closeB, "2026-09-01")).toBeNull();
    const people = await loadPeople(r, B, { personId: P.bGer, dono: true });
    expect(people.rows.map((p) => p.name)).toEqual(["Gerente do Centro"]);
  });
});

describe("parity: the session reader shows what the page showed with the service role", () => {
  const sorted = <T,>(xs: T[]) => [...xs].map((x) => JSON.stringify(x)).sort();

  it("A02_dono_of_B_sees_the_same_numbers", async () => {
    const r = accountReader(session.bDono, B);
    const dono = ALL("dono");
    const m = { allKitchens: true, kitchenIds: [] as string[], account: { id: B } as never };
    const now = new Date("2026-10-30T12:00:00-03:00");
    expect(await closePeriods(r, B)).toEqual(await closePeriods(admin, B));
    expect(sorted(await loadHomeLines(r, closeB, m))).toEqual(sorted(await loadHomeLines(admin, closeB, m)));
    expect(sorted(await loadHomeDiffs(r, closeB, m))).toEqual(sorted(await loadHomeDiffs(admin, closeB, m)));
    expect(await loadDecision(r, closeB, "2026-09-01")).toEqual(await loadDecision(admin, closeB, "2026-09-01"));
    expect(await loadReports(r, m)).toEqual(await loadReports(admin, m));
    expect(await loadOwnerContestations(r, B, dono)).toEqual(await loadOwnerContestations(admin, B, dono));
    expect(await loadConnect(r, B)).toEqual(await loadConnect(admin, B));
    expect(await loadLojas(r, B, dono, now)).toEqual(await loadLojas(admin, B, dono, now));
    expect(await loadPeople(r, B, { personId: P.bDono, dono: true }, now)).toEqual(await loadPeople(admin, B, { personId: P.bDono, dono: true }, now));
    expect(await loadAccessLog(r, B, P.bDono, now)).toEqual(await loadAccessLog(admin, B, P.bDono, now));
    expect(await loadDevices(r, P.bDono, "x", now)).toEqual(await loadDevices(admin, P.bDono, "x", now));
    expect(await loadNoticeRows(r, P.bDono, B, "dono")).toEqual(await loadNoticeRows(admin, P.bDono, B, "dono"));
    expect(await loadPlanView(r, B, null, now)).toEqual(await loadPlanView(admin, B, null, now));
  });

  it("A03_gerente_of_B_sees_the_same_scoped_numbers", async () => {
    const r = accountReader(session.bGer, B);
    const m = { allKitchens: false, kitchenIds: [CENTRO], account: { id: B } as never };
    const now = new Date("2026-10-30T12:00:00-03:00");
    const lines = await loadHomeLines(r, closeB, m);
    expect(lines.length).toBeGreaterThan(0);
    expect(sorted(lines)).toEqual(sorted(await loadHomeLines(admin, closeB, m)));
    expect(sorted(await loadHomeDiffs(r, closeB, m))).toEqual(sorted(await loadHomeDiffs(admin, closeB, m)));
    expect(await scopeKitchens(r, m)).toEqual(await scopeKitchens(admin, m));
    expect(await loadOwnerContestations(r, B, GERENTE)).toEqual(await loadOwnerContestations(admin, B, GERENTE));
    expect(await loadLojas(r, B, GERENTE, now)).toEqual(await loadLojas(admin, B, GERENTE, now));
    expect((await loadPeople(r, B, { personId: P.bGer, dono: false }, now)).rows).toEqual((await loadPeople(admin, B, { personId: P.bGer, dono: false }, now)).rows);
    expect(await loadReports(r, m)).toEqual([]);
  });

  it("A02_dono_of_A_reads_own_x_ray_report", async () => {
    const r = accountReader(session.aDono, A);
    const reports = await loadReports(r, { allKitchens: true, account: { id: A } as never });
    expect(reports.map((x) => x.kind).sort()).toEqual(["close", "xray"]);
  });
});
