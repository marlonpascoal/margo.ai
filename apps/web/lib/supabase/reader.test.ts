// A02, D63: the portal's read interface over a fake query client, so the scoping rule is tested alone.
// lib/portal/scoped-reads.int.test.ts proves it against RLS on the local stack.
import { describe, expect, it } from "vitest";
import { accountReader, personReader, type ReadableClient } from "./reader";

function fake() {
  const calls: { table: string; select?: unknown[]; eq: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      const call = { table, select: undefined as unknown[] | undefined, eq: [] as [string, unknown][] };
      calls.push(call);
      const filter = {
        eq(column: string, value: unknown) {
          call.eq.push([column, value]);
          return filter;
        },
      };
      return {
        select: (...args: unknown[]) => ((call.select = args), filter),
        insert: () => {
          throw new Error("write reached the client");
        },
      };
    },
  };
  return { client: client as unknown as ReadableClient, calls };
}

describe("accountReader", () => {
  it("A02_scopes_a_table_with_account_id_to_the_opened_account", () => {
    const { client, calls } = fake();
    accountReader(client, "acc-a").from("order_fact").select("*");
    expect(calls).toEqual([{ table: "order_fact", select: ["*"], eq: [["account_id", "acc-a"]] }]);
  });

  it("A02_scopes_account_by_its_id", () => {
    const { client, calls } = fake();
    accountReader(client, "acc-a").from("account").select("id");
    expect(calls[0].eq).toEqual([["id", "acc-a"]]);
  });

  it("A02_leaves_tables_without_account_id_to_rls", () => {
    const { client, calls } = fake();
    const r = accountReader(client, "acc-a");
    r.from("person").select("id");
    r.from("membership_kitchen").select("kitchen_id");
    expect(calls.map((c) => c.eq)).toEqual([[], []]);
  });

  it("A02_D47c_extract_tables_are_not_listed_so_a_portal_read_of_them_fails_loudly", () => {
    const { client, calls } = fake();
    const r = accountReader(client, "acc-a");
    for (const t of ["extract_run", "extract_content", "extract_copy", "public_store_private"] as const) r.from(t).select("*");
    expect(calls.map((c) => c.eq)).toEqual(Array(4).fill([["account_id", "acc-a"]]));
  });

  it("A02_passes_select_options_through_for_counts", () => {
    const { client, calls } = fake();
    accountReader(client, "acc-a").from("kitchen").select("id", { count: "exact", head: true });
    expect(calls[0].select).toEqual(["id", { count: "exact", head: true }]);
  });

  it("A02_exposes_no_write_method", () => {
    const { client } = fake();
    const q = accountReader(client, "acc-a").from("kitchen") as unknown as Record<string, unknown>;
    expect(Object.keys(q)).toEqual(["select"]);
  });
});

describe("personReader", () => {
  it("A02_adds_no_account_filter_before_an_account_is_chosen_and_stays_read_only", () => {
    const { client, calls } = fake();
    const q = personReader(client).from("membership");
    expect(Object.keys(q)).toEqual(["select"]);
    q.select("account_id");
    expect(calls[0].eq).toEqual([]);
  });
});
