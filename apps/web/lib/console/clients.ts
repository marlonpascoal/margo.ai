// C01 Clientes (05 §A): KPIs and the accounts table, derived from data. Copy verbatim from
// design/C01-Clientes.dc.html. 04-rules has no rule IDs for these counts; they are defined in 05 C01.
//
// Wave 0 stubs (tables land in wave 1, 03 §2 to §4): X-rays (xray), hours (time_log), leads (lead),
// differences and invoices. Each stub is marked `stubbed` so the screen and tests know.
import type { Db } from "@/lib/supabase/admin";
import { joinPt, plural } from "@/lib/format";
import type { Database } from "@margoai/contracts";

type Channel = Database["public"]["Enums"]["channel"];
type StoreSource = Database["public"]["Enums"]["store_source"];

export interface StoreFact {
  channel: Channel;
  authorized: boolean;
  source: StoreSource;
  kitchenId: string | null;
}
export interface KitchenFact {
  name: string;
  city: string | null;
}
export interface AccountFacts {
  id: string;
  name: string;
  code: string;
  isSynthetic: boolean;
  kitchens: KitchenFact[];
  stores: StoreFact[];
}

const CHANNEL_LABEL: Record<Channel, string> = { ifood: "iFood", food99: "99Food", keeta: "Keeta", rappi: "Rappi" };
const CHANNEL_ORDER: Channel[] = ["ifood", "food99", "keeta", "rappi"];

/**
 * A store is connected when the owner authorized it and data comes from the API, a file or the
 * extension; a store known only from its public page is not (D29).
 */
export const isConnected = (s: StoreFact) => s.authorized && s.source !== "public";

/** Only stores linked to a kitchen count (D29). */
export const linkedStores = (stores: StoreFact[]) => stores.filter((s) => s.kitchenId !== null).length;

/** "Igapó, Londrina" for one kitchen; the cities for more ("São Paulo"). */
export function placeLine(kitchens: KitchenFact[]): string {
  if (kitchens.length === 1) return [kitchens[0].name, kitchens[0].city].filter(Boolean).join(", ");
  return joinPt([...new Set(kitchens.map((k) => k.city).filter((c): c is string => !!c))]);
}

export type ModuleState = "none" | "pending" | "connected";
export interface ModuleStatus {
  state: ModuleState;
  label: string;
  /** True while the status cannot come from data yet (wave 1 tables). */
  stubbed?: boolean;
}

/** Module 2: connected channels, else "Autorização pendente" when the store is known, else not started. */
export function m2Status(stores: StoreFact[]): ModuleStatus {
  const channels = CHANNEL_ORDER.filter((c) => stores.some((s) => s.channel === c && isConnected(s)));
  if (channels.length) return { state: "connected", label: `Conectado · ${joinPt(channels.map((c) => CHANNEL_LABEL[c]))}` };
  if (stores.length) return { state: "pending", label: "Autorização pendente" };
  return { state: "none", label: "Não iniciado" };
}

/** Module 1 from `xray` (wave 1, lane A). */
export const m1Status = (): ModuleStatus => ({ state: "none", label: "Não iniciado", stubbed: true });

/** Module 3 from purchase invoices (wave 3). */
export const m3Status = (): ModuleStatus => ({ state: "none", label: "Não iniciado", stubbed: true });

/** "Próximo passo" follows the most advanced module. Difference counts join with C09 (wave 1, lane B). */
export function nextStep(m2: ModuleStatus): string {
  if (m2.state === "connected") return "Revisar diferenças";
  if (m2.state === "pending") return "Cobrar a autorização no iFood";
  return "Rodar o raio-X";
}

export interface ClientRow {
  code: string;
  name: string;
  detail: string;
  href: string;
  m1: ModuleStatus;
  m2: ModuleStatus;
  m3: ModuleStatus;
  next: string;
  isSynthetic: boolean;
}

export function clientRow(a: AccountFacts): ClientRow {
  const m2 = m2Status(a.stores);
  const stores = linkedStores(a.stores);
  const place = placeLine(a.kitchens);
  return {
    code: a.code,
    name: `${a.name} (código ${a.code})`,
    detail: [place, stores ? plural(stores, "loja", "lojas") : ""].filter(Boolean).join(" · "),
    // Row click opens the account (C19, structure).
    href: `/console/contas/${a.code}/estrutura`,
    m1: m1Status(),
    m2,
    m3: m3Status(),
    next: nextStep(m2),
    isSynthetic: a.isSynthetic,
  };
}

export interface Kpi {
  value: number;
  stubbed?: boolean;
}
export interface ClientsOverview {
  kpis: { funnel: Kpi; xraysDelivered: Kpi; ifoodConnected: Kpi; hoursThisMonth: Kpi };
  rows: ClientRow[];
  /** Show "dados fictícios": some row on screen is a synthetic account. */
  synthetic: boolean;
}

/** Accounts with at least one connected iFood store. */
export const ifoodConnectedCount = (accounts: AccountFacts[]) =>
  accounts.filter((a) => a.stores.some((s) => s.channel === "ifood" && isConnected(s))).length;

export async function loadClients(db: Db): Promise<ClientsOverview> {
  const { data, error } = await db
    .from("account")
    .select("id, name, code, is_synthetic, kitchen(name, city), channel_store(channel, authorized, source, kitchen_id)")
    .order("code");
  if (error) throw error;
  const accounts: AccountFacts[] = (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    code: a.code,
    isSynthetic: a.is_synthetic,
    kitchens: a.kitchen.map((k) => ({ name: k.name, city: k.city })),
    stores: a.channel_store.map((s) => ({ channel: s.channel, authorized: s.authorized, source: s.source, kitchenId: s.kitchen_id })),
  }));
  const rows = accounts.map(clientRow);
  return {
    kpis: {
      // Accounts plus leads; leads join with the lead table (05 §0).
      funnel: { value: accounts.length },
      xraysDelivered: { value: 0, stubbed: true },
      ifoodConnected: { value: ifoodConnectedCount(accounts) },
      hoursThisMonth: { value: 0, stubbed: true },
    },
    rows,
    synthetic: rows.some((r) => r.isSynthetic),
  };
}
