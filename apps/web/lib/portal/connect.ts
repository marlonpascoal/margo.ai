// P03 / W07 Conectar os apps (design/P03-Autorizar.dc.html, design/W07-Autorizar.dc.html, 05 §B, 06 §1,
// §9, D21, D39, D48). Accepting the terms writes owner_authorization per CNPJ, with who signed and the
// terms version; without it no real file of that CNPJ is processed (C06, 04 §11). The iFood step is "feito"
// once the merchant list returned stores (channel_store from the API); until then it shows "aguardando".
// No call to iFood from here: the merchant list is worker-import's job (06 §1).
import { PARTNER_PORTAL_ORIGIN } from "@margoai/contracts";
import type { Db } from "@/lib/supabase/admin";
import type { ReadDb } from "@/lib/supabase/reader";
import { cnpjTail } from "@/lib/m2/structure";
import { dayMonSP } from "./scope";

/** Version of docs/legal/autorizacao-dados.md the screen shows (D48). Bump when the lawyer's text lands. */
export const TERMS_VERSION = "rascunho-2026-10-30";
/** What the acceptance covers: the apps, the extension and purchase invoices (docs/legal §1). */
export const AUTHORIZATION_SCOPE = ["ifood", "food99", "extensao", "notas"];
/** The iFood Partner Portal, opened by the owner (we never act in it: D01a). */
export const PARTNER_PORTAL_URL = `${PARTNER_PORTAL_ORIGIN}/`;

export interface ConnectView {
  companies: { id: string; label: string; signedAt: string | null }[];
  pending: { id: string; label: string }[];
  /** W07 pill of step 1: "feito em 29/out" or "aguardando". */
  ifood: { done: boolean; label: string };
}

export interface ConnectInput {
  companies: { id: string; cnpj: string; legal_name: string }[];
  authorizations: { company_id: string; signed_at: string }[];
  apiStores: { authorized_at: string | null }[];
}

export function connectView(input: ConnectInput): ConnectView {
  const signed = new Map<string, string>();
  for (const a of input.authorizations) if (!signed.has(a.company_id) || a.signed_at < signed.get(a.company_id)!) signed.set(a.company_id, a.signed_at);
  const companies = [...input.companies]
    .sort((a, b) => a.cnpj.localeCompare(b.cnpj))
    .map((c) => ({ id: c.id, label: `${c.legal_name}, CNPJ ${cnpjTail(c.cnpj)}`, signedAt: signed.get(c.id) ?? null }));
  const first = input.apiStores.map((s) => s.authorized_at).filter((t): t is string => !!t).sort()[0];
  return {
    companies,
    pending: companies.filter((c) => !c.signedAt).map(({ id, label }) => ({ id, label })),
    ifood: first ? { done: true, label: `feito em ${dayMonSP(first)}` } : { done: false, label: "aguardando" },
  };
}

export async function loadConnect(db: ReadDb, accountId: string): Promise<ConnectView> {
  const [companies, auths, stores] = await Promise.all([
    db.from("company").select("id, cnpj, legal_name").eq("account_id", accountId),
    db.from("owner_authorization").select("company_id, signed_at").eq("account_id", accountId),
    db.from("channel_store").select("authorized_at").eq("account_id", accountId).eq("channel", "ifood").eq("source", "api").eq("authorized", true),
  ]);
  for (const r of [companies, auths, stores]) if (r.error) throw new Error(r.error.message);
  return connectView({ companies: companies.data ?? [], authorizations: auths.data ?? [], apiStores: stores.data ?? [] });
}

export interface Signer {
  personId: string;
  accountId: string;
}

/**
 * P03 "Autorizo a MargoAI a ler esses dados, inclusive com ferramentas de IA": one owner_authorization per
 * chosen CNPJ still without one, AI and international processing included (D48), audited (A04). Returns
 * the ids written. The caller has checked the Dono.
 */
export async function signAuthorization(
  db: Db,
  who: Signer,
  companyIds: string[],
  meta: { ip: string | null; userAgent: string | null },
  now = new Date(),
): Promise<string[]> {
  const view = await loadConnect(db, who.accountId);
  const chosen = view.pending.filter((c) => companyIds.includes(c.id));
  const written: string[] = [];
  for (const c of chosen) {
    const row = {
      account_id: who.accountId,
      company_id: c.id,
      scope: AUTHORIZATION_SCOPE,
      includes_ai: true,
      includes_international: true,
      signed_by: who.personId,
      signed_at: now.toISOString(),
      terms_version: TERMS_VERSION,
    };
    const { data, error } = await db.from("owner_authorization").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    const audit = await db.from("audit_log").insert({
      actor_person_id: who.personId,
      actor_kind: "person",
      account_id: who.accountId,
      action: "owner_authorization.sign",
      entity: "owner_authorization",
      entity_id: data.id,
      after: { company_id: c.id, scope: AUTHORIZATION_SCOPE, includes_ai: true, includes_international: true, terms_version: TERMS_VERSION },
      ip: meta.ip,
      user_agent: meta.userAgent,
    });
    if (audit.error) throw new Error(audit.error.message);
    written.push(data.id);
  }
  return written;
}
