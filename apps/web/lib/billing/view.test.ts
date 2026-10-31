// P09/W05 and C15 content, from rows (05 P09/W05 "Done when": total = price x kitchens in analysis).
import { describe, expect, it } from "vitest";
import { parseMoney, parsePct } from "./admin";
import { ASAAS_SANDBOX_URL } from "./asaas";
import { FAKE_PLANS } from "./fake-store";
import type { SubscriptionRow } from "./store";
import { buildC15View, buildPlanView, lucroCalc, shortAsaasId, type PlanInput } from "./view";

const sp = (local: string) => new Date(`${local}-03:00`);
const sub = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
  accountId: "g01",
  planId: "plan-lucro",
  status: "trial",
  asaasCustomerId: null,
  asaasSubscriptionId: null,
  nextDueOn: null,
  unitsBilled: 1,
  lastEvent: null,
  lastEventAt: null,
  ...over,
});
const input = (over: Partial<PlanInput>): PlanInput => ({
  plans: FAKE_PLANS,
  sub: sub({}),
  trialEndsAt: sp("2026-11-08T23:59:59"),
  units: 2,
  isSynthetic: true,
  invoices: [],
  returnStatus: null,
  now: sp("2026-10-30T10:00:00"),
  ...over,
});

describe("P09/W05", () => {
  it("W05_lucro_total_is_price_times_kitchens_in_analysis", () => {
    const lucro = FAKE_PLANS[1];
    expect(lucroCalc(lucro, 2)).toBe("2 cozinhas na análise = R$ 600/mês");
    expect(lucroCalc(lucro, 1)).toBe("1 cozinha na análise = R$ 300/mês");
    expect(lucroCalc({ ...lucro, billingUnit: "channel_store" }, 6)).toBe("6 lojas na análise = R$ 1.800/mês");
  });

  it("P09_W05_trial_as_drawn", () => {
    const v = buildPlanView(input({}));
    expect([v.phoneTitle, v.phoneLead, v.wideLead]).toEqual([
      "Seu teste grátis acaba em 9 dias",
      "Escolha como continuar. Se não escolher, a conta volta para o plano grátis e nada é cobrado.",
      "Teste grátis até 08/nov. Só cartão de crédito, pelo Asaas.",
    ]);
    expect(v.example).toBe(true);
    expect(v.cards.map((c) => [c.name, c.pricePhone, c.priceWide, c.calc, c.total, c.ctaWide, c.ctaPhone])).toEqual([
      ["Raio-X", "grátis", "grátis", "", "R$ 0", "Ficar no grátis", "Ficar no grátis"],
      ["Lucro", "R$ 300/cozinha/mês", "R$ 300 por cozinha/mês", "2 cozinhas na análise = R$ 600/mês", "R$ 600/mês", "Assinar pelo Asaas", "Continuar para o pagamento"],
      ["Rede", "5 cozinhas ou mais", "5 cozinhas ou mais", "", "a combinar", "Falar com a gente", "Falar com a gente"],
    ]);
    expect(v.cards[1].description).toBe("Fechamento mensal por canal, diferenças no repasse com contestação, e quanto sobra por item com o custo das notas.");
    expect(v.selected).toBe("lucro");
  });

  it("P10_return_shows_processando_until_the_webhook", () => {
    expect(buildPlanView(input({ returnStatus: "sucesso" })).banner).toBe("Pagamento processando. Assim que o Asaas confirmar, o plano aparece aqui.");
    const created = buildPlanView(input({ returnStatus: "sucesso", sub: sub({ asaasSubscriptionId: "sub_1", nextDueOn: "2026-11-08" }) }));
    expect(created.banner).toBeNull();
    expect(created.phoneTitle).toBe("Plano Lucro escolhido");
    expect(created.cards.map((c) => c.action)).toEqual(["none", "current", "rede"]);
    expect(buildPlanView(input({ returnStatus: "cancelado" })).banner).toBe("Pagamento não concluído. Nada foi cobrado.");
  });

  it("W05_active_and_free_states_and_invoices", () => {
    const active = buildPlanView(
      input({
        sub: sub({ status: "active", asaasSubscriptionId: "sub_1", nextDueOn: "2026-12-08" }),
        invoices: [{ asaasPaymentId: "pay_1", dueOn: "2026-11-08", units: 2, amountCents: 60000, status: "confirmed" }],
      }),
    );
    expect(active.wideLead).toBe("Seu plano: Lucro. Próxima cobrança em 08/dez. Só cartão de crédito, pelo Asaas.");
    expect(active.invoices).toEqual([{ id: "pay_1", month: "nov/2026", units: "2", value: "R$ 600,00", status: "paga" }]);
    const free = buildPlanView(input({ sub: sub({ status: "free", planId: "plan-raio_x" }) }));
    expect(free.cards.map((c) => c.action)).toEqual(["current", "checkout", "rede"]);
    expect(free.phoneTitle).toBe("Seu plano: Raio-X grátis");
    for (const t of [active.wideLead, free.phoneLead, free.wideLead]) expect(t).not.toMatch(/—/);
  });
});

describe("C15", () => {
  const plans = FAKE_PLANS.map((p) => (p.code === "lucro" ? { ...p, billingUnit: "channel_store" as const } : p));
  const accounts = [
    { id: "g01", code: "G-01", name: "Pantanos Burguer", trialEndsAt: sp("2026-11-08T23:59:59"), isSynthetic: true, createdAt: "2026-10-25" },
    { id: "g02", code: "G-02", name: "Grupo Exemplo", trialEndsAt: null, isSynthetic: true, createdAt: "2026-10-01" },
    { id: "g03", code: "G-03", name: "Grupo B", trialEndsAt: sp("2026-11-01T23:59:59"), isSynthetic: true, createdAt: "2026-10-18" },
    { id: "g04", code: "G-04", name: "Grupo C", trialEndsAt: null, isSynthetic: true, createdAt: "2026-10-27" },
  ];
  const subs = [
    sub({ accountId: "g04", planId: "plan-raio_x", status: "free", unitsBilled: 2 }),
    sub({ accountId: "g03", status: "trial", asaasCustomerId: "cus_0000000b4e", unitsBilled: 3, lastEvent: "aviso de fim enviado", lastEventAt: sp("2026-10-28T09:00:00") }),
    sub({ accountId: "g01", status: "trial", asaasCustomerId: "cus_000000077c2", unitsBilled: 1, lastEvent: "conta criada", lastEventAt: sp("2026-10-25T10:00:00") }),
    sub({ accountId: "g02", status: "active", asaasCustomerId: "cus_000000g02c", asaasSubscriptionId: "sub_00000000a91f", nextDueOn: "2026-11-05", unitsBilled: 6, lastEvent: "pagamento confirmado", lastEventAt: sp("2026-10-05T09:00:00") }),
  ];

  it("C15_kpis_and_table_as_drawn_on_30_out", () => {
    const v = buildC15View({
      plans,
      accounts,
      subs,
      pilots: [{ id: "p1", accountId: "g03", pct: 0.2, capCents: null, fixedFromDay61Cents: null, startedOn: null }],
      credited: new Map([["g03", [{ amountCents: 23800, creditedOn: "2026-10-20" }]]]),
      asaas: { baseUrl: ASAAS_SANDBOX_URL, apiKey: null },
      now: sp("2026-10-30T10:00:00"),
    });
    expect(v.kpis).toEqual({ trial: 2, trialDays: 14, paying: 1, revenue: "R$ 1.800", pastDue: 0 });
    expect(v.unit).toBe("loja");
    expect(v.labels).toEqual(["dados fictícios", "Asaas sandbox"]);
    expect(v.rows.map((r) => [r.account, r.plan, r.units, r.status, r.next, r.asaas, r.lastEvent])).toEqual([
      ["Grupo Exemplo (G-02)", "Lucro", "6", "ativa", "05/nov · R$ 1.800", "sub_…a91f", "pagamento confirmado 05/out"],
      ["Pantanos Burguer (G-01)", "Lucro (teste)", "1", "teste: faltam 9 dias", "sem cartão ainda", "cus_…77c2", "conta criada 25/out"],
      ["Grupo B (G-03)", "Lucro (teste)", "3", "teste: faltam 2 dias", "sem cartão ainda", "cus_…0b4e", "aviso de fim enviado 28/out"],
      ["Grupo C (G-04)", "Raio-X", "2", "grátis", "não cobra", "", ""],
    ]);
    expect(v.pilots.map((p) => [p.account, p.pct, p.cap, p.fixed, p.next])).toEqual([["Grupo B (G-03)", "20%", "", "", "20% de R$ 238 creditados = R$ 47,60"]]);
    expect(v.fixedHint).toBe("R$ 300 por loja");
  });

  it("C15_asaas_ids_and_inputs", () => {
    expect(shortAsaasId("sub_00000000a91f")).toBe("sub_…a91f");
    expect(shortAsaasId(null)).toBe("");
    expect(parseMoney("R$ 1.800")).toBe(180000);
    expect(parseMoney("300,5")).toBe(30050);
    expect(parseMoney("R$ 300 por cozinha")).toBe(30000);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeUndefined();
    expect(parsePct("20%")).toBe(0.2);
    expect(parsePct("12,5")).toBe(0.125);
    expect(parsePct("")).toBeNull();
    expect(parsePct("120%")).toBeUndefined();
  });
});
