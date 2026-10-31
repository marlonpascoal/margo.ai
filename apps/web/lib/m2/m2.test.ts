// Pure parts of the M2 console screens (C07, C08, C09, C16, C17, C19), against the drawn values.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bannerParts, closeRows, contestationLabel, sortDifferences, summarize, type DifferenceRecord, type LineRecord } from "./close";
import { claimTitle, nextStep, rowText, statusView, totals, whatsappLink, whoMarked, type ContestationRecord } from "./contestations";
import { evidenceCsv } from "./evidence";
import { brl, brlCents, deduction, durationLabel, MINUS, percent, periodLabel } from "./format";
import { buildRunRows, countLine, statusLabel, triggerLabel, whenLabel, type RunRecord } from "./imports";
import { checkLine, FIELDS, mappingFromForm, type MappingLog } from "./mapping";
import { cnpjTail, shortId, shortUrl, structureRows, type StoreRecord } from "./structure";

const sums = (channel: LineRecord["channel"], v: number[]): LineRecord => {
  const [gross, commission, payment, delivery, promotion, anticipation, payout] = v;
  return { channel, gross, commission, payment, delivery, promotion, anticipation, payout };
};

describe("C08 close table", () => {
  it("C03_C08_rows_per_channel_and_total_as_drawn", () => {
    // Two iFood stores and one 99Food store add up per channel.
    const rows = closeRows([
      sums("ifood", [5_000_000, -600_000, -160_000, -250_000, -200_000, -60_000, 3_730_000]),
      sums("food99", [1_860_000, -167_400, -59_500, -130_200, -55_800, 0, 1_447_100]),
      sums("ifood", [4_240_000, -508_800, -135_700, -212_000, -169_600, -61_000, 3_152_900]),
    ]);
    expect(rows.map((r) => [r.channel, ...r.cells])).toEqual([
      ["iFood", "R$ 92.400", `${MINUS}11.088`, `${MINUS}2.957`, `${MINUS}4.620`, `${MINUS}3.696`, `${MINUS}1.210`, "R$ 68.829", "74,5%"],
      ["99Food", "R$ 18.600", `${MINUS}1.674`, `${MINUS}595`, `${MINUS}1.302`, `${MINUS}558`, "0", "R$ 14.471", "77,8%"],
      ["Total", "R$ 111.000", `${MINUS}12.762`, `${MINUS}3.552`, `${MINUS}5.922`, `${MINUS}4.254`, `${MINUS}1.210`, "R$ 83.300", "75,0%"],
    ]);
    expect(rows[2].total).toBe(true);
  });
});

const diff = (o: Partial<DifferenceRecord>): DifferenceRecord => ({
  id: "d",
  rule_id: "DIF-01",
  description: "",
  channel: "ifood",
  store: "",
  orders_count: 1,
  amount_cents: 0,
  confidence: "certa",
  detail: {},
  contestation: null,
  ...o,
});

describe("C09 differences", () => {
  const ds = sortDifferences([
    diff({ rule_id: "DIF-04", amount_cents: 8_000, confidence: "provavel", channel: "food99" }),
    diff({ rule_id: "DIF-02", amount_cents: 23_800 }),
    diff({ rule_id: "DIF-03", amount_cents: 14_800, confidence: "provavel" }),
    diff({ rule_id: "DIF-01", amount_cents: 41_200 }),
    diff({ rule_id: "DIF-02", amount_cents: 12_000, channel: "food99" }),
    diff({ rule_id: "DIF-03", amount_cents: 18_600 }),
  ]);

  it("C03_C09_order_and_totals_as_drawn", () => {
    expect(ds.map((d) => d.amount_cents)).toEqual([41_200, 23_800, 18_600, 12_000, 14_800, 8_000]);
    const s = summarize(ds);
    expect([brl(s.certain.total), s.certain.count, brl(s.probable.total), s.probable.count]).toEqual(["R$ 956", 4, "R$ 228", 2]);
    expect(percent(s.certain.total, 11_100_000)).toBe("0,9%");
    expect(bannerParts(s)).toEqual(["6 diferenças no repasse", ", somando", "R$ 1.184", ". 4 certas, 2 prováveis."]);
  });

  it("C09_contestation_column_as_drawn", () => {
    const c = (o: Partial<NonNullable<DifferenceRecord["contestation"]>>) => ({ id: "c", status: "a_contestar" as const, deadline_on: null, marked_at: null, closed_at: null, credited_cents: null, ...o });
    const today = "2026-10-30";
    expect(contestationLabel(diff({ contestation: c({ status: "contestada", marked_at: "2026-10-02T13:15:00Z" }) }), today)).toBe("contestada em 02/out");
    expect(contestationLabel(diff({ amount_cents: 23_800, contestation: c({ status: "creditada", credited_cents: 23_800 }) }), today)).toBe("creditado R$ 238");
    expect(contestationLabel(diff({ contestation: c({ deadline_on: "2026-11-15" }) }), today)).toBe("contestar até 15/nov");
    expect(contestationLabel(diff({ contestation: c({ status: "precisa_resposta" }) }), today)).toBe("perguntar ao dono");
    expect(contestationLabel(diff({ rule_id: "DIF-04", confidence: "provavel" }), today)).toBe("esperar o próximo ciclo");
  });
});

const rec = (o: Partial<ContestationRecord>): ContestationRecord => ({
  differenceId: "d",
  contestationId: "c",
  rule: "DIF-03",
  short: "Cupom cofinanciado debitado inteiro",
  description: "",
  channel: "ifood",
  amount: 18_600,
  orders: 31,
  confidence: "certa",
  status: "a_contestar",
  closed: false,
  deadline: "2026-11-15",
  protocol: null,
  markedKind: null,
  markedRole: null,
  markedAt: null,
  creditedOn: null,
  claimText: "texto",
  reopenAfter: null,
  ...o,
});

describe("C16 contestations", () => {
  it("C04_C16_statuses_who_marked_and_next_step_as_drawn", () => {
    const contested = rec({ rule: "DIF-01", status: "contestada", amount: 41_200, markedKind: "person", markedRole: "dono", markedAt: "2026-10-02T13:15:00Z", protocol: "48213" });
    expect(statusView(contested).label).toBe("em análise");
    expect(whoMarked(contested)).toBe("dono, 02/out · protocolo 48213");
    const credited = rec({ rule: "DIF-02", status: "creditada", amount: 23_800, markedKind: "system", creditedOn: "2026-10-14" });
    expect(whoMarked(credited)).toBe("MargoAI, repasse de 14/out");
    expect(nextStep(credited, "2026-10-30")).toBe("nada");
    expect(nextStep(rec({}), "2026-10-30")).toBe("prazo 15/nov");
    expect(nextStep(rec({}), "2026-11-12")).toBe("prazo 15/nov · lembrar o dono");
    const waiting = rec({ rule: "DIF-04", status: null, contestationId: null, confidence: "provavel", channel: "food99", short: "Repasse da semana 37 menor", reopenAfter: "2026-11-10", amount: 8_000 });
    expect([statusView(waiting).label, whoMarked(waiting), nextStep(waiting, "2026-10-30"), rowText(waiting)]).toEqual([
      "esperando repasse",
      "MargoAI",
      "reabrir se não vier até 10/nov",
      "Repasse da semana 37 menor (99Food)",
    ]);
    expect(statusView(rec({ status: "precisa_resposta" })).label).toBe("resposta do dono");
    expect(claimTitle(rec({}))).toBe("Texto pronto · DIF-03, cupom cofinanciado");
  });

  it("C16_totals_as_drawn", () => {
    const t = totals([
      rec({ status: "contestada", amount: 41_200 }),
      rec({ status: "creditada", amount: 23_800 }),
      rec({ status: "a_contestar", amount: 18_600 }),
      rec({ status: "a_contestar", amount: 12_000 }),
      rec({ status: "precisa_resposta", amount: 14_800 }),
      rec({ status: null, amount: 8_000 }),
      rec({ status: "precisa_resposta", amount: 999, closed: true }),
    ]);
    expect([t.toContest, t.contested, t.credited, t.denied, t.waiting].map(brl)).toEqual(["R$ 306", "R$ 412", "R$ 238", "R$ 0", "R$ 228"]);
  });

  it("whatsapp_link_is_click_to_chat", () => {
    expect(whatsappLink("+5543900001234", "a b")).toBe("https://wa.me/5543900001234?text=a%20b");
    expect(whatsappLink(null, "x")).toBeNull();
  });
});

describe("C07 import history", () => {
  const run = (o: Partial<RunRecord>): RunRecord => ({
    id: "r",
    created_at: "2026-10-28T18:02:00Z",
    trigger: "upload",
    channel: "food99",
    store_ids: ["a", "b"],
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    file_path: "imports/x.xlsx",
    file_name: "extrato.xlsx",
    rows_total: 1022,
    duration_ms: 8000,
    status: "needs_mapping",
    log: { columns: [{ known: true }, { known: false }, { known: false }, { known: false }] },
    source_kind: "upload",
    created_by_name: "Manuel",
    ...o,
  });
  const now = new Date("2026-10-30T12:00:00-03:00");

  it("C07_rows_as_drawn", () => {
    const [r] = buildRunRows([run({})], now);
    expect([r.when, r.trigger, r.source, r.stores, r.period, r.rows, r.duration, r.status, r.action?.label]).toEqual([
      "28/out 15:02",
      "upload (Manuel)",
      "99Food · extrato.xlsx",
      "2",
      "set/2026",
      "1.022",
      "8 s",
      "3 colunas novas",
      "corrigir",
    ]);
    expect(r.action?.href).toBe("/console/importacoes/r/corrigir");
    expect(whenLabel(new Date("2026-10-30T06:00:00-03:00"), now)).toBe("hoje 06:00");
    expect(whenLabel(new Date("2026-10-29T21:14:00-03:00"), now)).toBe("ontem 21:14");
    expect(triggerLabel({ trigger: "upload", source_kind: "bpo_folder", created_by_name: null })).toBe("pasta do BPO");
    expect(statusLabel({ status: "failed", log: { reason: "token_expired" } }).text).toBe("falhou: token expirado");
    expect(statusLabel({ status: "running", log: { progress: 60 } }).text).toBe("rodando 60%");
    expect(periodLabel("2026-10-24", "2026-10-30")).toBe("24 a 30/out");
    expect(periodLabel("2026-10-03", "2026-10-09")).toBe("03 a 09/out");
    expect(durationLabel(120_000)).toBe("2 min");
    expect(countLine(8, 214, "2026-10-10T08:30:00Z")).toBe("Mostrando 8 de 214 importações desde 10/out. Uma linha repetida em duas importações conta uma vez só.");
  });
});

describe("C17 mapping", () => {
  const log: MappingLog = {
    signature: "s",
    columns: [
      { name: "ID do pedido", example: "99F-8812304", field: "order_id", known: true },
      { name: "Subsídio da plataforma", example: "4,00", field: null, known: false },
    ],
    proposal: { columns: { "ID do pedido": "order_id" }, decimal: ",", date_format: "%d/%m/%Y" },
    rows_in_file: 1022,
    payout_total_file_cents: 1_447_100,
    payout_total_mapped_cents: 1_447_100,
  };

  it("C02_C17_check_block_bate_or_shows_the_gap", () => {
    expect(checkLine(log)).toEqual({ file: "R$ 14.471,00", mapped: "R$ 14.471,00 · bate", ok: true });
    expect(checkLine({ ...log, payout_total_mapped_cents: 1_440_000 }).ok).toBe(false);
    expect(brlCents(-12)).toBe(`${MINUS}R$ 0,12`);
  });

  it("C02_C17_every_new_column_needs_a_decision", () => {
    const form = new FormData();
    expect(mappingFromForm(log, form).undecided).toEqual(["Subsídio da plataforma"]);
    form.set("col-1", "discount_channel");
    const m = mappingFromForm(log, form);
    expect(m.undecided).toEqual([]);
    expect(m.columns).toEqual({ "ID do pedido": "order_id", "Subsídio da plataforma": "discount_channel" });
    expect(m.missing).toEqual(["loja", "data do pedido", "venda bruta", "repasse"]);
  });

  it("C17_fields_are_the_worker_fields", () => {
    const py = readFileSync(fileURLToPath(new URL("../../../../workers/import/src/margo_import/layout.py", import.meta.url)), "utf8");
    const block = py.slice(py.indexOf("FIELDS: dict[str, str] = {"), py.indexOf("}", py.indexOf("FIELDS: dict[str, str] = {")));
    const pairs = Object.fromEntries([...block.matchAll(/"(\w+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
    expect(FIELDS).toEqual(pairs);
  });
});

describe("C19 structure", () => {
  const store = (o: Partial<StoreRecord>): StoreRecord => ({
    id: "s",
    channel: "ifood",
    external_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    public_url: "https://www.ifood.com.br/delivery/sao-paulo-sp/centro-burger-do-bairro/3fa85f64-5717-4562-b3fc-2c963f66afa6",
    source: "api",
    created_at: "2026-10-10T14:05:00Z",
    kitchen: { id: "k", name: "Cozinha Centro", in_analysis: true, cnpj: "12345678000110" },
    brand: "Burger do Bairro",
    ...o,
  });

  it("C19_rows_as_drawn", () => {
    expect([cnpjTail("12345678000110"), shortId("3fa85f64-5717-4562-b3fc-2c963f66afa6"), shortUrl(store({}).public_url, "ifood"), shortUrl(null, "food99")]).toEqual([
      "…/0001-10",
      "3fa85f64-…-a6",
      "…/centro-burger-do-bairro/3fa85f64…",
      "link da 99Food",
    ]);
    const rows = structureRows(
      [store({ id: "new", kitchen: null, brand: null, created_at: "2026-10-29T09:00:00Z" }), store({}), store({ id: "off", kitchen: { id: "k3", name: "Quiosque Shopping", in_analysis: false, cnpj: "12345678000291" } })],
      new Date("2026-10-30T12:00:00-03:00"),
    );
    expect(rows.map((r) => [r.id, r.link, r.source])).toEqual([
      ["s", "vinculada", "API de lojas"],
      ["off", "fora da análise", "API de lojas"],
      ["new", "sem cozinha: vincular", "API de lojas (nova)"],
    ]);
  });
});

describe("formats and evidence", () => {
  it("money_and_order_sheet", () => {
    expect([brl(9_240_000), deduction(-1_108_800), deduction(0), percent(1_447_100, 1_860_000)]).toEqual(["R$ 92.400", `${MINUS}11.088`, "0", "77,8%"]);
    expect(evidenceCsv("DIF-03", [{ order: "IF-1", orderedAt: "01/09/2026 11:00", store: "Loja; Centro", gross: 6680, amount: 633 }])).toBe(
      'Regra;Pedido;Data do pedido;Loja;Venda bruta;Diferença\nDIF-03;IF-1;01/09/2026 11:00;"Loja; Centro";66,80;6,33\n',
    );
  });
});
