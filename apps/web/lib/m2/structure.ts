// C19 Estrutura do cliente (design/C19-Estrutura.dc.html, 05 §A, D29): conta, CNPJ, cozinha, loja em cada
// app. Only stores linked to a kitchen in analysis count for close and billing; linking writes audit_log.
import type { Database } from "@margoai/contracts";
import type { Db } from "@/lib/supabase/admin";
import { audit, type M2Account } from "./account";
import { CHANNEL_LABEL, type Channel } from "./format";

type Source = Database["public"]["Enums"]["store_source"];

export interface StoreRecord {
  id: string;
  channel: Channel;
  external_id: string;
  public_url: string | null;
  source: Source;
  created_at: string;
  kitchen: { id: string; name: string; in_analysis: boolean; cnpj: string } | null;
  brand: string | null;
}

export type LinkTone = "ok" | "pend" | "off";

export interface StructureRow {
  id: string;
  cnpj: string;
  kitchen: string;
  brand: string;
  app: string;
  externalId: string;
  url: string;
  source: string;
  link: string;
  tone: LinkTone;
  needsLink: boolean;
}

/** "…/0001-10": the branch part of the CNPJ, as drawn. */
export const cnpjTail = (cnpj: string) => (cnpj.length === 14 ? `…/${cnpj.slice(8, 12)}-${cnpj.slice(12)}` : cnpj);

/** "3fa85f64-…-a6": uuid shortened as drawn; other ids whole. */
export const shortId = (id: string) => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id) ? `${id.slice(0, 8)}-…-${id.slice(-2)}` : id);

/** "…/centro-burger-do-bairro/3fa85f64…"; 99Food stores have their own link (D29). */
export function shortUrl(url: string | null, channel: Channel): string {
  if (!url) return channel === "food99" ? "link da 99Food" : "";
  const parts = url.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return `…/${parts[parts.length - 2] ?? ""}/${last.slice(0, 8)}…`;
}

const SOURCE_LABEL: Record<Source, string> = { api: "API de lojas", file: "extrato Excel", public: "página pública", extension: "extensão", manual: "manual" };

export function sourceLabel(s: StoreRecord, newSince: Date): string {
  const base = s.channel === "ifood" && s.source === "file" ? "arquivo do portal" : SOURCE_LABEL[s.source];
  return !s.kitchen && new Date(s.created_at) >= newSince ? `${base} (nova)` : base;
}

/** A store without kitchen that arrived in the last 30 days is "(nova)". */
export function structureRows(stores: StoreRecord[], now: Date): StructureRow[] {
  const newSince = new Date(now.getTime() - 30 * 86_400_000);
  const linked = stores.filter((s) => s.kitchen).sort((a, b) => (a.kitchen!.cnpj + a.kitchen!.name).localeCompare(b.kitchen!.cnpj + b.kitchen!.name));
  const ordered = [...linked, ...stores.filter((s) => !s.kitchen)];
  return ordered.map((s) => {
    const k = s.kitchen;
    const tone: LinkTone = !k ? "pend" : k.in_analysis ? "ok" : "off";
    return {
      id: s.id,
      cnpj: k ? cnpjTail(k.cnpj) : "?",
      kitchen: k ? k.name : "?",
      brand: s.brand ?? "?",
      app: CHANNEL_LABEL[s.channel],
      externalId: shortId(s.external_id),
      url: shortUrl(s.public_url, s.channel),
      source: sourceLabel(s, newSince),
      link: !k ? "sem cozinha: vincular" : k.in_analysis ? "vinculada" : "fora da análise",
      tone,
      needsLink: !k,
    };
  });
}

export async function loadStructure(db: Db, account: M2Account) {
  const [{ data: stores, error }, { data: kitchens }, { data: brands }, { count: companies }] = await Promise.all([
    db
      .from("channel_store")
      .select("id, channel, external_id, public_url, source, created_at, kitchen(id, name, in_analysis, company(cnpj)), brand(name)")
      .eq("account_id", account.id),
    db.from("kitchen").select("id, name, in_analysis").eq("account_id", account.id).order("name"),
    db.from("brand").select("id, name").eq("account_id", account.id).order("name"),
    db.from("company").select("id", { count: "exact", head: true }).eq("account_id", account.id),
  ]);
  if (error) throw new Error(error.message);
  const records: StoreRecord[] = (stores ?? []).map((s) => ({
    id: s.id,
    channel: s.channel,
    external_id: s.external_id,
    public_url: s.public_url,
    source: s.source,
    created_at: s.created_at,
    kitchen: s.kitchen ? { id: s.kitchen.id, name: s.kitchen.name, in_analysis: s.kitchen.in_analysis, cnpj: s.kitchen.company?.cnpj ?? "" } : null,
    brand: s.brand?.name ?? null,
  }));
  return {
    records,
    kitchens: kitchens ?? [],
    brands: brands ?? [],
    counts: {
      companies: companies ?? 0,
      kitchens: kitchens?.length ?? 0,
      billed: (kitchens ?? []).filter((k) => k.in_analysis).length,
      brands: brands?.length ?? 0,
      stores: records.length,
    },
  };
}

/** C19 "vincular": a store without kitchen joins a kitchen (and brand) of the same account (D29). */
export async function linkStore(
  db: Db,
  account: M2Account,
  staffId: string,
  storeId: string,
  kitchenId: string,
  brandId: string | null,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const { data: store } = await db.from("channel_store").select("id, kitchen_id, brand_id").eq("id", storeId).eq("account_id", account.id).maybeSingle();
  const { data: kitchen } = await db.from("kitchen").select("id").eq("id", kitchenId).eq("account_id", account.id).maybeSingle();
  if (!store || !kitchen) throw new Error("loja ou cozinha de outra conta");
  const after = { kitchen_id: kitchenId, brand_id: brandId ?? store.brand_id };
  const { error } = await db.from("channel_store").update(after).eq("id", storeId);
  if (error) throw new Error(error.message);
  await audit(db, { actor: staffId, accountId: account.id, action: "channel_store.link", entity: "channel_store", entityId: storeId, before: { kitchen_id: store.kitchen_id, brand_id: store.brand_id }, after, meta });
}
