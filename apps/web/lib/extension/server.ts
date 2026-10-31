// P04 Chrome extension, database side (06 §9, 03 extension_token, D01a). Server code only, service role.
// A token is scoped to one person and one account, stored hashed, revocable; every write is audited (A04).
// The upload goes into the same import queue as every other file (D31, C07), checked by C06 first.
import type { Json } from "@margoai/contracts";
import { queueRun } from "@/lib/m2/imports";
import type { M2Account } from "@/lib/m2/account";
import type { Db } from "@/lib/supabase/admin";
import {
  checkUpload,
  generatePairingCode,
  generateToken,
  normalizePairingCode,
  PAIRING_MINUTES,
  requestedReports,
  sha256Hex,
  UPLOAD_MESSAGES,
  UPLOAD_TYPES,
  type RequestedReport,
} from "./core";

export interface Meta {
  ip: string | null;
  userAgent: string | null;
}

export interface ExtensionAuth {
  tokenId: string;
  personId: string;
  accountId: string;
}

type Actor = { personId: string; kind: "person" | "staff" };

async function audit(db: Db, actor: Actor, accountId: string, action: string, entity: string, entityId: string | null, meta: Meta, after: unknown = null, before: unknown = null) {
  const { error } = await db.from("audit_log").insert({
    actor_person_id: actor.personId,
    actor_kind: actor.kind,
    account_id: accountId,
    action,
    entity,
    entity_id: entityId,
    before: before as Json,
    after: after as Json,
    ip: meta.ip,
    user_agent: meta.userAgent,
  });
  if (error) throw new Error(error.message);
}

type R<T> = { data: T; error: { message: string } | null };
/** A row that may be absent. */
const maybe = <T>(r: R<T>): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
/** A row or rows that must be there. */
const must = <T>(r: R<T>): NonNullable<T> => {
  const d = maybe(r);
  if (d === null || d === undefined) throw new Error("expected a row");
  return d;
};

async function membership(db: Db, personId: string, accountId: string) {
  return maybe(await db.from("membership").select("id, role, all_kitchens").eq("person_id", personId).eq("account_id", accountId).maybeSingle());
}

/**
 * A short code for the extension of `personId` in `accountId`, valid 10 minutes, once. Made by the person in
 * the portal (W07) or by a founder in the console for that person. Null when the person is not a member.
 */
export async function createPairingCode(
  db: Db,
  req: { personId: string; accountId: string; actor: Actor },
  meta: Meta,
  now: Date,
): Promise<{ code: string; expiresAt: Date } | null> {
  if (!(await membership(db, req.personId, req.accountId))) return null;
  const code = generatePairingCode();
  const expiresAt = new Date(now.getTime() + PAIRING_MINUTES * 60_000);
  const row = must(
    await db
      .from("extension_token")
      .insert({ person_id: req.personId, account_id: req.accountId, token_hash: sha256Hex(code), pairing_expires_at: expiresAt.toISOString(), created_by: req.actor.personId })
      .select("id")
      .single(),
  );
  await audit(db, req.actor, req.accountId, "extension_token.code", "extension_token", row.id, meta, { person_id: req.personId, expires_at: expiresAt.toISOString() });
  return { code, expiresAt };
}

export type PairResult = { ok: true; token: string; accountName: string } | { ok: false; status: 400 | 404; message: string };

/**
 * The extension sends the code; it gets its long token once. The code stops working (its hash is replaced by
 * the token's). A05: when the account's flag is off the code is refused as unknown.
 */
export async function pairExtension(db: Db, rawCode: string, flagOn: (accountId: string) => Promise<boolean>, meta: Meta, now: Date): Promise<PairResult> {
  const code = normalizePairingCode(rawCode);
  if (!code) return { ok: false, status: 400, message: UPLOAD_MESSAGES.badCode };
  const row = maybe(
    await db
      .from("extension_token")
      .select("id, person_id, account_id, token_hash, pairing_expires_at, account(name)")
      .eq("token_hash", sha256Hex(code))
      .is("paired_at", null)
      .is("revoked_at", null)
      .maybeSingle(),
  );
  if (!row || !row.pairing_expires_at || new Date(row.pairing_expires_at) <= now || !(await flagOn(row.account_id))) {
    return { ok: false, status: 404, message: UPLOAD_MESSAGES.badCode };
  }
  const token = generateToken();
  const done = must(
    await db
      .from("extension_token")
      .update({ token_hash: sha256Hex(token), paired_at: now.toISOString(), pairing_expires_at: null, last_used_at: now.toISOString() })
      .eq("id", row.id)
      .eq("token_hash", row.token_hash)
      .is("paired_at", null)
      .select("id"),
  );
  if (done.length !== 1) return { ok: false, status: 404, message: UPLOAD_MESSAGES.badCode };
  await audit(db, { personId: row.person_id, kind: "person" }, row.account_id, "extension_token.pair", "extension_token", row.id, meta, { paired_at: now.toISOString() });
  return { ok: true, token, accountName: row.account?.name ?? "" };
}

/** A paired, not revoked token of a person who is still a member of the account. Marks last use. */
export async function authenticateExtension(db: Db, token: string | null, now: Date): Promise<ExtensionAuth | null> {
  if (!token) return null;
  const row = maybe(
    await db
      .from("extension_token")
      .select("id, person_id, account_id")
      .eq("token_hash", sha256Hex(token))
      .not("paired_at", "is", null)
      .is("revoked_at", null)
      .maybeSingle(),
  );
  if (!row || !(await membership(db, row.person_id, row.account_id))) return null;
  await db.from("extension_token").update({ last_used_at: now.toISOString() }).eq("id", row.id);
  return { tokenId: row.id, personId: row.person_id, accountId: row.account_id };
}

/** Revoked by the person (portal) or a founder (console). Revoking twice changes nothing. */
export async function revokeExtensionToken(db: Db, tokenId: string, accountId: string, actor: Actor, meta: Meta, now: Date): Promise<boolean> {
  const rows = must(
    await db.from("extension_token").update({ revoked_at: now.toISOString() }).eq("id", tokenId).eq("account_id", accountId).is("revoked_at", null).select("id"),
  );
  if (rows.length !== 1) return false;
  await audit(db, actor, accountId, "extension_token.revoke", "extension_token", tokenId, meta, { revoked_at: now.toISOString() });
  return true;
}

export interface ExtensionStore {
  id: string;
  name: string;
}

/** iFood stores the person may see (A03: a Gerente only those of their kitchens). */
async function visibleStores(db: Db, auth: ExtensionAuth): Promise<(ExtensionStore & { kitchenId: string | null })[]> {
  const m = await membership(db, auth.personId, auth.accountId);
  if (!m) return [];
  const stores = must(await db.from("channel_store").select("id, name, kitchen_id").eq("account_id", auth.accountId).eq("channel", "ifood").order("name"));
  if (m.all_kitchens) return stores.map((s) => ({ id: s.id, name: s.name, kitchenId: s.kitchen_id }));
  const kitchens = new Set(must(await db.from("membership_kitchen").select("kitchen_id").eq("membership_id", m.id)).map((k) => k.kitchen_id));
  return stores.filter((s) => s.kitchen_id && kitchens.has(s.kitchen_id)).map((s) => ({ id: s.id, name: s.name, kitchenId: s.kitchen_id }));
}

export interface ExtensionStatus {
  account: { name: string; synthetic: boolean };
  person: string;
  stores: ExtensionStore[];
  reports: RequestedReport[];
  /** Last extension upload that imported, ISO. */
  lastUpload: string | null;
}

/** P04: connected status, stores, the reports MargoAI asks for, last upload. */
export async function extensionStatus(db: Db, auth: ExtensionAuth, now: Date): Promise<ExtensionStatus> {
  const [account, person, stores, sources] = await Promise.all([
    db.from("account").select("name, is_synthetic").eq("id", auth.accountId).single(),
    db.from("person").select("name").eq("id", auth.personId).single(),
    visibleStores(db, auth),
    db.from("import_source").select("kind, last_ok_at").eq("account_id", auth.accountId).eq("channel", "ifood"),
  ]);
  const src = must(sources);
  return {
    account: { name: must(account).name, synthetic: must(account).is_synthetic },
    person: must(person).name,
    stores: stores.map(({ id, name }) => ({ id, name })),
    reports: requestedReports(now, src.some((s) => s.kind === "api")),
    lastUpload: src.find((s) => s.kind === "extension")?.last_ok_at ?? null,
  };
}

export type UploadResult = { ok: true; importRunId: string } | { ok: false; status: 400 | 403 | 413 | 415; message: string };

/**
 * POST /api/extension/upload: the report file the owner chose, into the iFood import queue (trigger
 * extension). C06, 04 §11: a real account needs a signed owner_authorization for the store's CNPJ (or, with
 * no store chosen, for some CNPJ of the account); worker-import checks every CNPJ in the file again.
 * Duplicate rows count once (natural keys, D31).
 */
export async function uploadFromExtension(
  db: Db,
  auth: ExtensionAuth,
  input: { file: File | null; storeId: string | null; reports: string[] },
  meta: Meta,
): Promise<UploadResult> {
  const { file } = input;
  if (!file || file.size === 0) return { ok: false, status: 400, message: UPLOAD_MESSAGES.noFile };
  const check = checkUpload(file.name, file.size);
  if (!check.ok) return check;

  const acc = must(await db.from("account").select("id, code, name, is_synthetic").eq("id", auth.accountId).single());
  const account: M2Account = { id: acc.id, code: acc.code, name: acc.name, isSynthetic: acc.is_synthetic };
  const stores = await visibleStores(db, auth);
  const store = input.storeId ? stores.find((s) => s.id === input.storeId) : null;
  if (input.storeId && !store) return { ok: false, status: 400, message: UPLOAD_MESSAGES.store };

  if (!account.isSynthetic) {
    let q = db.from("owner_authorization").select("id", { count: "exact", head: true }).eq("account_id", account.id);
    if (store) {
      const kitchen = store.kitchenId ? must(await db.from("kitchen").select("company_id").eq("id", store.kitchenId).single()) : null;
      if (!kitchen) return { ok: false, status: 403, message: UPLOAD_MESSAGES.noAuthorization };
      q = q.eq("company_id", kitchen.company_id);
    }
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    if (!count) return { ok: false, status: 403, message: UPLOAD_MESSAGES.noAuthorization };
  }

  const source = must(
    await db.from("import_source").upsert({ account_id: account.id, channel: "ifood", kind: "extension" }, { onConflict: "account_id,channel,kind", ignoreDuplicates: false }).select("id").single(),
  );
  const id = crypto.randomUUID();
  const name = file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_");
  const objectPath = `${account.code}/${id}/${name}`;
  const up = await db.storage.from("imports").upload(objectPath, new Uint8Array(await file.arrayBuffer()), { contentType: UPLOAD_TYPES[check.ext] });
  if (up.error) throw new Error(up.error.message);
  const reports = input.reports.filter((r) => /^[a-z_]{1,40}$/.test(r));
  maybe(
    await db.from("import_run").insert({
      id,
      account_id: account.id,
      source_id: source.id,
      trigger: "extension",
      channel: "ifood",
      store_ids: store ? [store.id] : [],
      file_path: `imports/${objectPath}`,
      file_name: name,
      created_by: auth.personId,
      log: { reports },
    }),
  );
  await queueRun(db, account, id, "ifood");
  await audit(db, { personId: auth.personId, kind: "person" }, account.id, "import_run.extension_upload", "import_run", id, meta, {
    file_name: name,
    store_id: store?.id ?? null,
    reports,
    token_id: auth.tokenId,
  });
  return { ok: true, importRunId: id };
}

/** Console list (P04 from C07): members, and their paired tokens and codes still valid, newest first. */
export async function loadExtensionTokens(db: Db, accountId: string, now = new Date()) {
  const [members, tokens] = await Promise.all([
    db.from("membership").select("person_id, role, person(name)").eq("account_id", accountId).order("role"),
    db.from("extension_token").select("id, person_id, paired_at, last_used_at, pairing_expires_at, revoked_at, created_at").eq("account_id", accountId).order("created_at", { ascending: false }),
  ]);
  return {
    members: must(members).map((m) => ({ personId: m.person_id, role: m.role, name: m.person?.name ?? "" })),
    rows: must(tokens).filter((t) => t.paired_at || (t.pairing_expires_at && new Date(t.pairing_expires_at) > now && !t.revoked_at)),
  };
}
