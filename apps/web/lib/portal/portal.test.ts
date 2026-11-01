// Owner account screens, pure parts: A03 scope, P13/W02, P12/W03, P14/W04, P03/W07, E04 copy.
import { describe, expect, it } from "vitest";
import { canPortal, type MemberRole, type PortalAction } from "@/lib/permissions";
import { connectView } from "./connect";
import { infoOf, kitchenApp, ownerTotals, pillOf, PILL_LABEL, whatHappened, type OwnerContestation } from "./contestacoes";
import { lojasLead, lojasView, type LojasInput } from "./lojas";
import { MATRIX, peopleView } from "./pessoas";
import { INVITE_MESSAGES, inviteKitchens, normalizeWhatsapp, OWNER_EVENTS, peopleError, seesKitchen, shortKitchen, whatsappShort, whenLabel, type Scope } from "./scope";

const DONO: Scope = { role: "dono", allKitchens: true, kitchenIds: [] };
const GERENTE_CENTRO: Scope = { role: "gerente", allKitchens: false, kitchenIds: ["centro"] };
const NOW = new Date("2026-10-30T12:00:00-03:00");

describe("A03 kitchen scope", () => {
  it("A03_gerente_sees_only_own_kitchens_and_no_account_wide_rows", () => {
    expect(seesKitchen(GERENTE_CENTRO, "centro")).toBe(true);
    expect(seesKitchen(GERENTE_CENTRO, "zonasul")).toBe(false);
    expect(seesKitchen(GERENTE_CENTRO, null)).toBe(false);
    expect(seesKitchen(DONO, null)).toBe(true);
    expect(seesKitchen({ role: "financeiro", allKitchens: true, kitchenIds: [] }, "zonasul")).toBe(true);
  });
});

// G-SYN Grupo Exemplo as seeded (supabase/seed/g_syn.sql).
const GSYN: LojasInput = {
  companies: [
    { id: "c2", cnpj: "12345678000291" },
    { id: "c1", cnpj: "12345678000110" },
  ],
  kitchens: [
    { id: "shopping", name: "Quiosque Shopping", address: "Shopping Exemplo", company_id: "c2", in_analysis: false },
    { id: "centro", name: "Cozinha Centro", address: "Rua Exemplo, 100", company_id: "c1", in_analysis: true },
    { id: "zonasul", name: "Cozinha Zona Sul", address: "Av. Exemplo, 2000", company_id: "c2", in_analysis: true },
  ],
  stores: [
    { id: "s1", kitchen_id: "centro", channel: "ifood", external_id: "3fa8", name: "Burger do Bairro Centro", public_url: "https://x/1", brand: "Burger do Bairro" },
    { id: "s2", kitchen_id: "centro", channel: "ifood", external_id: "9b1c", name: "Frango Crocante Centro", public_url: "https://x/2", brand: "Frango Crocante" },
    { id: "s3", kitchen_id: "centro", channel: "food99", external_id: "99F-1", name: "Burger do Bairro Centro", public_url: null, brand: "Burger do Bairro" },
    { id: "s4", kitchen_id: "zonasul", channel: "ifood", external_id: "c47e", name: "Burger do Bairro Zona Sul", public_url: "https://x/4", brand: "Burger do Bairro" },
    { id: "s5", kitchen_id: "zonasul", channel: "food99", external_id: "99F-2", name: "Burger do Bairro Zona Sul", public_url: null, brand: "Burger do Bairro" },
    { id: "s6", kitchen_id: "shopping", channel: "ifood", external_id: "5d2f", name: "Milkshake Bar Shopping", public_url: "https://x/6", brand: "Milkshake Bar" },
    { id: "s7", kitchen_id: null, channel: "ifood", external_id: "e801b6c4-3a5f", name: "Burger do Bairro", public_url: "https://x/7", brand: null },
  ],
  lastOk: { ifood: "2026-10-30T09:00:00Z", food99: "2026-10-28T15:00:00Z" },
};

describe("P13/W02 Lojas", () => {
  it("W02_dono_sees_every_kitchen_as_drawn", () => {
    const v = lojasView(GSYN, DONO, NOW);
    expect(lojasLead("Grupo Exemplo", v)).toBe("Grupo Exemplo · 2 CNPJs · 3 cozinhas · 7 lojas nos apps.");
    expect(v.kitchens.map((k) => [k.name, k.cnpjTail, k.storesLine, k.arriving])).toEqual([
      ["Cozinha Centro", "…/0001-10", "Burger do Bairro (iFood, 99Food) · Frango Crocante (iFood)", "iFood hoje 06:00 · 99Food 28/out"],
      ["Cozinha Zona Sul", "…/0002-91", "Burger do Bairro (iFood, 99Food)", "iFood hoje 06:00 · 99Food 28/out"],
      ["Quiosque Shopping", "…/0002-91", "Milkshake Bar (iFood)", "fora da análise"],
    ]);
    expect(v.kitchens.map((k) => k.cnpjLine)).toEqual(["CNPJ 1 · Rua Exemplo, 100", "CNPJ 2 · Av. Exemplo, 2000", "CNPJ 2 · Shopping Exemplo"]);
    expect(v.kitchens[0].storesLink).toBe("ver as lojas no iFood e na 99Food");
    expect(v.inAnalysis).toBe(2);
    expect(v.newStores.map((s) => s.text)).toEqual(["Apareceu uma loja nova no iFood (Burger do Bairro, id e801…). Em qual cozinha ela fica?"]);
  });

  it("A03_W02_gerente_do_centro_sees_only_centro_and_no_new_store", () => {
    const v = lojasView(GSYN, GERENTE_CENTRO, NOW);
    expect(v.kitchens.map((k) => k.name)).toEqual(["Cozinha Centro"]);
    expect(lojasLead("Grupo Exemplo", v)).toBe("Grupo Exemplo · 1 CNPJ · 1 cozinha · 3 lojas nos apps.");
    expect(v.newStores).toEqual([]);
    expect(JSON.stringify(v)).not.toMatch(/Zona Sul|Shopping|Milkshake|e801/);
  });
});

const C = (o: Partial<OwnerContestation>): OwnerContestation => ({
  differenceId: "d",
  contestationId: "c",
  rule: "DIF-01",
  short: "Comissão de 15% no lugar de 12%",
  description: "",
  channel: "ifood",
  kitchen: "Cozinha Centro",
  amount: 41200,
  status: "a_contestar",
  closed: false,
  deadline: "2026-11-15",
  protocol: null,
  markedAt: null,
  creditedOn: null,
  claimText: "texto",
  ...o,
});

describe("P12/W03 Contestações", () => {
  it("W03_pills_and_info_as_drawn", () => {
    const today = "2026-10-30";
    expect([pillOf(C({})), infoOf(C({}), today).w03, infoOf(C({}), today).p12]).toEqual(["contestar", "até 15/nov", "prazo até 15/nov"]);
    const a = C({ status: "contestada", protocol: "48213", markedAt: "2026-10-02T13:15:00Z" });
    expect([PILL_LABEL[pillOf(a)].w03, infoOf(a, today).w03, infoOf(a, today).p12]).toEqual(["em análise", "protocolo 48213", "protocolo 48213 · desde 02/out"]);
    expect(infoOf(C({ status: "contestada", markedAt: "2026-10-30T15:00:00Z" }), today).w03).toBe("contestada hoje");
    expect(infoOf(C({ status: "creditada", creditedOn: "2026-10-14" }), today).w03).toBe("voltou em 14/out");
    expect(pillOf(C({ status: "precisa_resposta", closed: true }))).toBe("ok");
    expect(pillOf(C({ status: null, contestationId: null }))).toBe("espera");
    expect(PILL_LABEL[pillOf(C({ status: "prazo_vencido" }))].w03).toBe("prazo vencido");
    expect(kitchenApp(C({ kitchen: "Cozinha Zona Sul", channel: "food99" }))).toBe("Zona Sul · 99Food");
    expect(whatHappened(C({ short: "Cancelamento por atraso", channel: "food99" }))).toBe("Cancelamento por atraso (99Food)");
  });

  it("W03_totals_are_the_four_drawn_boxes", () => {
    const t = ownerTotals([
      C({ status: "a_contestar", amount: 640 }),
      C({ status: "a_contestar", amount: 380 }),
      C({ status: "contestada", amount: 780 }),
      C({ status: "creditada", amount: 410 }),
      C({ status: "precisa_resposta", amount: 200 }),
      C({ status: "precisa_resposta", amount: 999, closed: true }),
      C({ status: "negada", amount: 5 }),
    ]);
    expect(t).toEqual({ toContest: 1020, inAnalysis: 780, back: 410, needsAnswer: 200 });
  });

  it("C04_owner_events_never_include_system_transitions", () => {
    expect([...OWNER_EVENTS].sort()).toEqual(["foi_combinado_nao", "foi_combinado_sim", "foi_negada", "ja_contestei"]);
    expect(OWNER_EVENTS).not.toContain("credito_encontrado");
    expect(OWNER_EVENTS).not.toContain("prazo_passou");
  });
});

describe("P14/W04 Pessoas", () => {
  const input = {
    kitchens: [
      { id: "centro", name: "Cozinha Centro" },
      { id: "zonasul", name: "Cozinha Zona Sul" },
    ],
    members: [
      { id: "m3", person_id: "p3", role: "gerente" as MemberRole, all_kitchens: false, kitchen_ids: ["centro"], name: "Gerente do Centro", email: null, whatsapp: "+5543900005678", last_seen: "2026-10-27T15:00:00Z" },
      { id: "m2", person_id: "p2", role: "financeiro" as MemberRole, all_kitchens: true, kitchen_ids: [], name: "Pessoa do financeiro", email: "financeiro@exemplo.com.br", whatsapp: null, last_seen: "2026-10-29T20:40:00Z" },
      { id: "m1", person_id: "p1", role: "dono" as MemberRole, all_kitchens: true, kitchen_ids: [], name: "Dono do grupo", email: "dono@exemplo.com.br", whatsapp: "+5543900001234", last_seen: "2026-10-30T11:12:00Z" },
    ],
    invites: [{ id: "i1", name: "Contador", destination: "contador@exemplo.com.br", role: "financeiro" as MemberRole, kitchen_ids: [], created_at: "2026-10-29T13:02:00Z" }],
  };

  it("W04_rows_as_drawn", () => {
    const v = peopleView(input, "p1", NOW);
    expect(v.rows.map((r) => [r.name, r.contact, r.kitchensShort, r.lastAccess, r.isSelf])).toEqual([
      ["Dono do grupo", "dono@exemplo.com.br", "todas", "hoje 08:12", true],
      ["Pessoa do financeiro", "financeiro@exemplo.com.br", "todas", "ontem 17:40", false],
      ["Gerente do Centro", "WhatsApp (43) 9…", "Centro", "27/out", false],
      ["Contador", "convite enviado 29/out", "todas", "pendente", false],
    ]);
    expect(v.rows.map((r) => r.kitchensLong)).toEqual(["todas as cozinhas", "todas as cozinhas", "Cozinha Centro", "todas as cozinhas"]);
  });

  it("W04_matrix_matches_the_permission_module", () => {
    const action: PortalAction[] = ["see_close", "contestations", "send_invoices", "see_xray", "choose_kitchens", "billing", "people"];
    MATRIX.forEach((row, i) => {
      for (const [role, cell] of [["dono", row.d], ["financeiro", row.f], ["gerente", row.g]] as const) {
        expect(cell !== "·", `${row.a} ${role}`).toBe(canPortal(role, action[i]));
      }
    });
  });

  it("E04_errors_say_why_in_portuguese", () => {
    expect(peopleError("E04_last_dono: the account must keep one Dono")).toBe("Toda conta precisa de pelo menos um Dono. Faça outra pessoa Dono antes.");
    expect(peopleError("E04_locked: people changes are locked")).toMatch(/24 horas/);
    expect(peopleError("something else")).toBe("Não deu certo. Tente de novo.");
  });

  it("A03_P14_gerente_invite_needs_at_least_one_kitchen", () => {
    // Marlon, 31/out: a Gerente is invited to chosen kitchens only; other profiles with none chosen see all.
    expect(inviteKitchens("gerente", [])).toEqual({ ok: false, error: INVITE_MESSAGES.gerenteNeedsKitchen });
    expect(inviteKitchens("gerente", ["", " "])).toEqual({ ok: false, error: INVITE_MESSAGES.gerenteNeedsKitchen });
    expect(inviteKitchens("gerente", ["centro"])).toEqual({ ok: true, kitchens: ["centro"] });
    expect(inviteKitchens("financeiro", [])).toEqual({ ok: true, kitchens: [] });
    expect(inviteKitchens("financeiro", ["centro"])).toEqual({ ok: true, kitchens: ["centro"] });
    expect(inviteKitchens("dono", ["centro"])).toEqual({ ok: true, kitchens: [] });
  });

  it("P14_contacts_are_normalized", () => {
    expect(normalizeWhatsapp("(43) 99999-1234")).toBe("+5543999991234");
    expect(normalizeWhatsapp("+55 43 9999-1234")).toBe("+554399991234");
    expect(normalizeWhatsapp("123")).toBeNull();
    expect(whatsappShort("+5543900005678")).toBe("WhatsApp (43) 9…");
    expect(shortKitchen("Cozinha Zona Sul")).toBe("Zona Sul");
    expect(whenLabel("2026-10-30T09:00:00Z", NOW)).toBe("hoje 06:00");
  });
});

describe("P03/W07 Conectar", () => {
  it("C06_W07_pending_cnpjs_and_ifood_status", () => {
    const companies = [
      { id: "c1", cnpj: "12345678000110", legal_name: "Exemplo Alimentos Ltda" },
      { id: "c2", cnpj: "12345678000291", legal_name: "Exemplo Alimentos Ltda" },
    ];
    const none = connectView({ companies, authorizations: [], apiStores: [] });
    expect(none.pending.map((c) => c.label)).toEqual(["Exemplo Alimentos Ltda, CNPJ …/0001-10", "Exemplo Alimentos Ltda, CNPJ …/0002-91"]);
    expect(none.ifood).toEqual({ done: false, label: "aguardando" });
    const one = connectView({ companies, authorizations: [{ company_id: "c1", signed_at: "2026-10-10T14:00:00Z" }], apiStores: [{ authorized_at: "2026-10-29T09:00:00Z" }, { authorized_at: null }] });
    expect(one.pending.map((c) => c.id)).toEqual(["c2"]);
    expect(one.ifood).toEqual({ done: true, label: "feito em 29/out" });
  });
});
