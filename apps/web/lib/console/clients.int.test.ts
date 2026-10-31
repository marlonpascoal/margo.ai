// C01 against the G-SYN seed on the local stack: KPIs equal independent SQL counts (05 C01 "Done when").
import { describe, expect, it } from "vitest";
import { adminClient } from "@/lib/supabase/admin";
import { loadClients } from "./clients";
import { loadSettings } from "./settings";

const db = adminClient();

describe("C01 on the seed", () => {
  it("C01_kpis_match_sql_counts_on_the_seed", async () => {
    const { kpis, rows, synthetic } = await loadClients(db);

    const accounts = await db.from("account").select("*", { count: "exact", head: true });
    expect(kpis.funnel.value).toBe(accounts.count);

    const connected = await db.from("channel_store").select("account_id").eq("channel", "ifood").eq("authorized", true).neq("source", "public");
    expect(kpis.ifoodConnected.value).toBe(new Set(connected.data!.map((r) => r.account_id)).size);

    // Wave 1 tables (xray, time_log) are not there yet.
    expect(kpis.xraysDelivered).toEqual({ value: 0, stubbed: true });
    expect(kpis.hoursThisMonth).toEqual({ value: 0, stubbed: true });

    // G-SYN as drawn: 4 accounts, 1 with iFood connected, all synthetic.
    expect(kpis.funnel.value).toBe(4);
    expect(kpis.ifoodConnected.value).toBe(1);
    expect(synthetic).toBe(true);
    expect(rows.map((r) => [r.name, r.detail, r.m2.label, r.next])).toEqual([
      ["Pantanos Burguer (código G-01)", "Igapó, Londrina · 1 loja", "Autorização pendente", "Cobrar a autorização no iFood"],
      ["Grupo Exemplo (código G-02)", "São Paulo · 6 lojas", "Conectado · iFood e 99Food", "Revisar diferenças"],
      ["Grupo B (código G-03)", "", "Não iniciado", "Rodar o raio-X"],
      ["Grupo C (código G-04)", "", "Não iniciado", "Rodar o raio-X"],
    ]);
  });

  it("C14_settings_on_the_seed", async () => {
    const s = await loadSettings(db);
    expect(s.authorizations.map((a) => [a.title, a.status])).toEqual([
      ["Pantanos Burguer (G-01)", "assinada 29/out"],
      ["Grupo Exemplo (G-02)", "assinada 10/out"],
      ["Grupo Exemplo (G-02)", "assinada 10/out"],
      ["Grupo B (G-03)", "não precisa ainda"],
      ["Grupo C (G-04)", "não precisa ainda"],
    ]);
    expect(s.staff).toEqual(
      expect.arrayContaining([
        { name: "Marlon", role: "Fundador" },
        { name: "Manuel", role: "Fundador" },
      ]),
    );
  });
});
