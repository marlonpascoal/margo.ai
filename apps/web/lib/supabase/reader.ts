// The one read interface of the owner portal (D63, 02 §5). Pages and loaders depend on ReadDb and nothing else,
// so changing the mechanism touches this file and sessionReader() in ./server.ts. Today: the person's Supabase
// session, so RLS applies, plus a filter to the opened account. RLS stops other accounts and other kitchens
// (A02, A03); the filter stops a person's other account, and everything else a staff person could read.
import type { Database } from "@margoai/contracts";
import type { PostgrestQueryBuilder } from "@supabase/supabase-js";
import type { Db } from "./admin";

type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables & string;

type TableQuery<N extends TableName> = PostgrestQueryBuilder<{ PostgrestVersion: "12" }, Database["public"], Tables[N], N>;

/** Read-only by construction: a table offers select and nothing else. The service-role client fits it too. */
export interface ReadDb {
  from<N extends TableName>(table: N): Pick<TableQuery<N>, "select">;
}

/** What the reader needs from a client. */
export type ReadableClient = Pick<Db, "from">;

type WithoutAccountColumn = { [N in TableName]: "account_id" extends keyof Tables[N]["Row"] ? never : N }[TableName];

/**
 * Tables with no account_id: RLS alone scopes them. A table missing here is filtered by account_id and fails
 * loudly (no such column), never open; the type refuses a table that does have the column.
 */
const NO_ACCOUNT_COLUMN: ReadonlySet<string> = new Set<WithoutAccountColumn>([
  "person",
  "membership_kitchen",
  "session_device",
  "channel_store_url_history",
  "plan",
  "notice_type",
  "rule_param",
  "ingredient",
]);

function reader(client: ReadableClient, scope: (table: string) => [string, string] | null): ReadDb {
  const from = (table: string) => ({
    select: (...args: unknown[]) => {
      const query = (client.from as unknown as (t: string) => { select(...a: unknown[]): { eq(c: string, v: string): unknown } })(table).select(...args);
      const filter = scope(table);
      return filter ? query.eq(filter[0], filter[1]) : query;
    },
  });
  return { from } as unknown as ReadDb;
}

/** Reads of one opened account (requireMember, requirePortal). */
export function accountReader(client: ReadableClient, accountId: string): ReadDb {
  return reader(client, (table) => (table === "account" ? ["id", accountId] : NO_ACCOUNT_COLUMN.has(table) ? null : ["account_id", accountId]));
}

/** Reads before an account is open (P15 chooser): RLS alone, so the person's own memberships. */
export function personReader(client: ReadableClient): ReadDb {
  return reader(client, () => null);
}
