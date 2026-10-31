// P13 / W02 Lojas (design/P13-MinhasLojas.dc.html, design/W02-Lojas.dc.html, 05 §B, D29, D40): kitchens
// with their CNPJ, the stores of each kitchen per app, data arriving, the in-analysis toggle (Dono, drives
// units_billed at the next charge) and the new iFood store without kitchen. Data filtered by kitchen scope
// (A03): a Gerente sees only their kitchens and never a store without kitchen.
import type { Db } from "@/lib/supabase/admin";
import { CHANNEL_LABEL, CHANNEL_ORDER, plural, type Channel } from "@/lib/m2/format";
import { cnpjTail } from "@/lib/m2/structure";
import { seesKitchen, shortKitchen, whenLabel, type Scope } from "./scope";

export interface StoreView {
  id: string;
  brand: string;
  channel: Channel;
  app: string;
  url: string | null;
}

export interface KitchenView {
  id: string;
  name: string;
  short: string;
  address: string;
  cnpjTail: string;
  /** P13: "CNPJ 1 · Rua Exemplo, 100" */
  cnpjLine: string;
  inAnalysis: boolean;
  stores: StoreView[];
  /** W02: "Burger do Bairro (iFood, 99Food) · Frango Crocante (iFood)" */
  storesLine: string;
  /** W02: "ver as lojas no iFood e na 99Food" */
  storesLink: string;
  /** W02 "Dados chegando": "iFood hoje 06:00 · 99Food 28/out", or "fora da análise". */
  arriving: string;
  arrivingTone: "ok" | "muted";
}

export interface NewStoreView {
  id: string;
  /** "Apareceu uma loja nova no iFood (Burger do Bairro, id e801…). Em qual cozinha ela fica?" */
  text: string;
}

export interface LojasView {
  companies: number;
  kitchens: KitchenView[];
  stores: number;
  inAnalysis: number;
  newStores: NewStoreView[];
}

const IN_APP: Record<Channel, string> = { ifood: "no iFood", food99: "na 99Food", keeta: "no Keeta", rappi: "no Rappi" };

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

export interface LojasInput {
  companies: { id: string; cnpj: string }[];
  kitchens: { id: string; name: string; address: string | null; company_id: string; in_analysis: boolean }[];
  stores: { id: string; kitchen_id: string | null; channel: Channel; external_id: string; name: string; public_url: string | null; brand: string | null }[];
  /** Latest successful import per channel (import_source.last_ok_at). */
  lastOk: Partial<Record<Channel, string>>;
}

/** P13/W02 view for one person's scope (A03). Pure: the loader below does the I/O. */
export function lojasView(input: LojasInput, scope: Scope, now: Date): LojasView {
  const companyIndex = new Map([...input.companies].sort((a, b) => a.cnpj.localeCompare(b.cnpj)).map((c, i) => [c.id, { n: i + 1, cnpj: c.cnpj }]));
  const visible = input.kitchens.filter((k) => seesKitchen(scope, k.id));
  const kitchens = [...visible]
    .sort((a, b) => (companyIndex.get(a.company_id)?.n ?? 0) - (companyIndex.get(b.company_id)?.n ?? 0) || Number(b.in_analysis) - Number(a.in_analysis) || a.name.localeCompare(b.name))
    .map((k): KitchenView => {
      const company = companyIndex.get(k.company_id);
      const stores = input.stores
        .filter((s) => s.kitchen_id === k.id)
        .map((s) => ({ id: s.id, brand: s.brand ?? s.name, channel: s.channel, app: CHANNEL_LABEL[s.channel], url: s.public_url }))
        .sort((a, b) => a.brand.localeCompare(b.brand) || CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel));
      const byBrand = new Map<string, string[]>();
      for (const s of stores) byBrand.set(s.brand, [...(byBrand.get(s.brand) ?? []), s.app]);
      const channels = CHANNEL_ORDER.filter((c) => stores.some((s) => s.channel === c));
      const arriving = k.in_analysis
        ? channels.map((c) => `${CHANNEL_LABEL[c]} ${input.lastOk[c] ? whenLabel(input.lastOk[c]!, now) : "sem dados ainda"}`).join(" · ")
        : "fora da análise";
      return {
        id: k.id,
        name: k.name,
        short: shortKitchen(k.name),
        address: k.address ?? "",
        cnpjTail: company ? cnpjTail(company.cnpj) : "",
        cnpjLine: [company ? `CNPJ ${company.n}` : "", k.address ?? ""].filter(Boolean).join(" · "),
        inAnalysis: k.in_analysis,
        stores,
        storesLine: [...byBrand].map(([b, apps]) => `${b} (${apps.join(", ")})`).join(" · "),
        storesLink: channels.length ? `ver as lojas ${joinPt(channels.map((c) => IN_APP[c]))}` : "",
        arriving: arriving || "sem lojas ainda",
        arrivingTone: k.in_analysis ? "ok" : "muted",
      };
    });
  const newStores = seesKitchen(scope, null)
    ? input.stores
        .filter((s) => !s.kitchen_id)
        .map((s) => ({
          id: s.id,
          text: `Apareceu uma loja nova ${IN_APP[s.channel]} (${s.brand ?? s.name}, id ${s.external_id.slice(0, 4)}…). Em qual cozinha ela fica?`,
        }))
    : [];
  const visibleStores = input.stores.filter((s) => (s.kitchen_id ? visible.some((k) => k.id === s.kitchen_id) : seesKitchen(scope, null)));
  return {
    companies: new Set(visible.map((k) => k.company_id)).size,
    kitchens,
    stores: visibleStores.length,
    inAnalysis: kitchens.filter((k) => k.inAnalysis).length,
    newStores,
  };
}

/** W02 lead: "Grupo Exemplo · 2 CNPJs · 3 cozinhas · 7 lojas nos apps." */
export function lojasLead(accountName: string, v: LojasView): string {
  return `${accountName} · ${plural(v.companies, "CNPJ", "CNPJs")} · ${plural(v.kitchens.length, "cozinha", "cozinhas")} · ${plural(v.stores, "loja", "lojas")} nos apps.`;
}

export async function loadLojas(db: Db, accountId: string, scope: Scope, now = new Date()): Promise<LojasView> {
  const [companies, kitchens, stores, sources] = await Promise.all([
    db.from("company").select("id, cnpj").eq("account_id", accountId),
    db.from("kitchen").select("id, name, address, company_id, in_analysis").eq("account_id", accountId),
    db.from("channel_store").select("id, kitchen_id, channel, external_id, name, public_url, brand(name)").eq("account_id", accountId),
    db.from("import_source").select("channel, last_ok_at").eq("account_id", accountId).not("last_ok_at", "is", null),
  ]);
  for (const r of [companies, kitchens, stores, sources]) if (r.error) throw new Error(r.error.message);
  const lastOk: Partial<Record<Channel, string>> = {};
  for (const s of sources.data ?? []) {
    if (s.last_ok_at && (!lastOk[s.channel] || s.last_ok_at > lastOk[s.channel]!)) lastOk[s.channel] = s.last_ok_at;
  }
  return lojasView(
    {
      companies: companies.data ?? [],
      kitchens: kitchens.data ?? [],
      stores: (stores.data ?? []).map((s) => ({ ...s, brand: s.brand?.name ?? null })),
      lastOk,
    },
    scope,
    now,
  );
}
