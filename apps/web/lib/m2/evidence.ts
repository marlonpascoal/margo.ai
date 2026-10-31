// C09, C16 evidence: the orders behind one difference, as a CSV the owner attaches to the claim
// ("Baixar planilha (31 pedidos)"). Columns in Portuguese; values in reais with a decimal comma.
import type { Db } from "@/lib/supabase/admin";

const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const money = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, "0")}`;

export interface EvidenceRow {
  order: string;
  orderedAt: string;
  store: string;
  gross: number;
  amount: number;
}

export function evidenceCsv(rule: string, rows: EvidenceRow[]): string {
  const head = ["Regra", "Pedido", "Data do pedido", "Loja", "Venda bruta", "Diferença"];
  const lines = rows.map((r) => [rule, r.order, r.orderedAt, r.store, money(r.gross), money(r.amount)].map(cell).join(";"));
  return [head.join(";"), ...lines].join("\n") + "\n";
}

export async function loadEvidence(db: Db, accountId: string, differenceId: string): Promise<{ rule: string; rows: EvidenceRow[] } | null> {
  const { data: d } = await db.from("difference").select("rule_id").eq("id", differenceId).eq("account_id", accountId).maybeSingle();
  if (!d) return null;
  const { data, error } = await db
    .from("difference_order")
    .select("amount_cents, order_fact(external_order_id, ordered_at, gross_cents, channel_store(name))")
    .eq("difference_id", differenceId);
  if (error) throw new Error(error.message);
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  const rows = (data ?? [])
    .map((r) => ({
      order: r.order_fact!.external_order_id,
      orderedAt: fmt.format(new Date(r.order_fact!.ordered_at)),
      sortKey: r.order_fact!.ordered_at,
      store: r.order_fact!.channel_store?.name ?? "",
      gross: r.order_fact!.gross_cents,
      amount: r.amount_cents,
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ sortKey: _s, ...r }) => r);
  return { rule: d.rule_id, rows };
}
