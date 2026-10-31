// Pure parts of C10, C11 and P05, against the drawn values (design/C10-Notas, C11-Depara, P05-WhatsNota).
import { describe, expect, it } from "vitest";
import { deparaRows, howLabel, spendShares, type LineRecord, type MatchRecord } from "./depara";
import { linePricePerBase, unitPriceLabel } from "./format";
import { keyCheckDigit, keyFromInput, keyIssuer, keyModel, keyValid } from "./keys";
import { coverage, missingLine, parseReais, zipStatsLines, type TopIngredient } from "./notas";
import { invoiceRequestText, qrReadReplyText } from "./P05-whatsapp-nota";

const FIRST43 = "4126101234567800019065001000001234112345678";

describe("C10 access key (06 §5)", () => {
  it("D01_check_digit_mod_11_same_as_the_database", () => {
    // app.nfe_access_key_valid accepts 6 after 4126101234567800019055001000001234112345678.
    expect(keyCheckDigit("4126101234567800019055001000001234112345678")).toBe(6);
    const key = FIRST43 + keyCheckDigit(FIRST43);
    expect(keyValid(key)).toBe(true);
    expect(keyValid(FIRST43 + ((keyCheckDigit(FIRST43) + 1) % 10))).toBe(false);
    expect(keyModel(key)).toBe(65);
    expect(keyIssuer(key)).toBe("12345678000190");
  });

  it("D01_typed_key_with_spaces_and_qr_link", () => {
    const key = FIRST43 + keyCheckDigit(FIRST43);
    const spaced = key.match(/.{1,4}/g)!.join(" ");
    expect(keyFromInput(spaced)).toEqual({ key, source: "key_typed" });
    expect(keyFromInput(`https://www.fazenda.pr.gov.br/nfce/qrcode?p=${key}|2|1|1|ABCDEF`)).toEqual({ key, source: "qr_url" });
  });

  it("D01_invalid_key_rejected_before_saving", () => {
    expect(keyFromInput(FIRST43 + ((keyCheckDigit(FIRST43) + 1) % 10))).toBeNull();
    expect(keyFromInput("https://www.fazenda.pr.gov.br/nfce/qrcode?x=1")).toBeNull();
    expect(keyFromInput("123")).toBeNull();
    const m57 = "4126101234567800019057001000001234112345678";
    expect(keyFromInput(m57 + keyCheckDigit(m57))).toBeNull();
  });
});

describe("C10 zip stats and coverage", () => {
  it("D01_zip_stats_as_drawn", () => {
    expect(
      zipStatsLines({ id: "r", status: "ok", invoices_new: 312, months_count: 12, suppliers_count: 41, nfe_count: 268, nfce_count: 44, duplicates: 9, log: {} }),
    ).toEqual(["312 notas · 12 meses · 41 fornecedores", "NF-e: 268 · NFC-e: 44 · duplicadas: 9"]);
    expect(zipStatsLines({ id: "r", status: "failed", invoices_new: null, months_count: null, suppliers_count: null, nfe_count: null, nfce_count: null, duplicates: null, log: { reason: "not_zip" } })).toEqual([
      "A importação falhou: o arquivo não é um .zip.",
    ]);
  });

  const t = (name: string, short: string | null, base: TopIngredient["base_unit"], price: TopIngredient["price"]): TopIngredient => ({ id: name, name, short_name: short, base_unit: base, price });

  it("C10_coverage_rows_and_P05_text_list_only_missing_top20", () => {
    const c = coverage([
      t("Queijo cheddar fatiado", "queijo cheddar", "g", null),
      t("Carne bovina moída (blend)", null, "g", { centsPerBase: 3.89, observedOn: "2026-10-12", model: 55 }),
      t("Refrigerante lata 350 ml", null, "un", { centsPerBase: 285, observedOn: "2026-10-03", model: 65 }),
      t("Óleo de soja", null, "ml", { centsPerBase: 0.84, observedOn: "2026-09-21", model: 55 }),
      t("Bacon em cubos", "bacon", "g", null),
      t("Pão brioche", "pão brioche", "un", null),
      t("Embalagem kraft", "embalagem", "un", null),
    ]);
    expect(c.rows.map((r) => [r.name, r.price, r.source])).toEqual([
      ["Carne bovina moída (blend)", "R$ 38,90/kg", "nota de 12/out"],
      ["Refrigerante lata 350 ml", "R$ 2,85/un", "cupom de 03/out"],
      ["Óleo de soja", "R$ 8,40/l", "nota de 21/set"],
      ["Queijo cheddar fatiado", "sem preço", "falta nota"],
      ["Bacon em cubos", "sem preço", "falta nota"],
      ["Pão brioche", "sem preço", "falta nota"],
      ["Embalagem kraft", "sem preço", "falta nota"],
    ]);
    expect([c.covered, c.total]).toEqual([3, 7]);
    expect(missingLine(c.missing.length)).toBe("Faltam 4 insumos.");
    const text = invoiceRequestText(c.missing);
    expect(text).toBe(
      "Oi! Faltam 4 itens para fechar o custo do cardápio: queijo cheddar, bacon, pão brioche e embalagem. Quando chegar uma nota com qualquer um deles, manda uma foto aqui. Só isso.",
    );
    expect(c.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
    expect(text).not.toMatch(/carne|refrigerante|óleo/i);
    expect(coverage([t("Carne", null, "g", { centsPerBase: 3.89, observedOn: "2026-10-12", model: 55 })]).whatsapp).toBeNull();
  });

  it("P05_reply_after_a_qr_is_read", () => {
    expect(qrReadReplyText("Bacon em cubos", "R$ 46,00/kg", 3)).toBe("Li a nota pelo QR code: Bacon em cubos, R$ 46,00/kg. Obrigado! Agora faltam 3.");
  });

  it("P05_no_em_dash_in_any_text", () => {
    const all = [invoiceRequestText(["a"]), qrReadReplyText("a", "b", 0), qrReadReplyText("a", "b", 1), missingLine(1)].join(" ");
    expect(all).not.toMatch(/—/);
  });

  it("C10_money_typed_from_the_public_page", () => {
    expect(parseReais("R$ 1.234,50")).toBe(123450);
    expect(parseReais("46")).toBe(4600);
    expect(parseReais("0")).toBeNull();
    expect(parseReais("abc")).toBeNull();
  });
});

describe("C11 de-para", () => {
  const m = (o: Partial<MatchRecord>): MatchRecord => ({
    id: "m",
    ingredient_id: "i",
    ingredient: "Insumo",
    base_unit: "g",
    method: "rule",
    status: "confirmed",
    conversion_factor: 1000,
    confirmed_by: null,
    rule: null,
    ...o,
  });
  const l = (id: string, description: string, unit: string, qty: number, total: number, matches: MatchRecord[], issued = "2026-10-01T10:00:00-03:00"): LineRecord => ({
    id,
    description,
    ncm: null,
    unit,
    qty,
    total_cents: total,
    issued_at: issued,
    matches,
  });

  const lines = [
    l("1", "CARNE BOV MOIDA PATINHO/ACEM 80/20 KG", "KG", 10, 38900, [m({ ingredient: "Carne bovina moída (blend)", rule: { ncm_prefix: "02013000", unit: null } })]),
    l("2", "REFRIG COCA COLA LT 350ML", "UN", 100, 28500, [m({ ingredient: "Refrigerante lata 350 ml", method: "gtin", base_unit: "un", conversion_factor: 1 })]),
    l("3", "QJO PROC CHED FAT 2,27KG 160FT", "PC", 2, 23654, [m({ ingredient: "Queijo cheddar fatiado", method: "ai", status: "suggested", conversion_factor: 2270 })]),
    l("4", "PAO HAMB BRIOCHE GERG C/12", "PCT", 10, 13800, [m({ ingredient: "Pão brioche", method: "ai", status: "suggested", base_unit: "un", conversion_factor: 12 })]),
    l("5", "GAS GLP P13", "UN", 1, 11500, []),
    l("6", "CARNE BOV MOIDA PATINHO/ACEM 80/20 KG", "KG", 5, 19450, [m({ ingredient: "Carne bovina moída (blend)", rule: { ncm_prefix: "02013000", unit: null } })], "2026-09-01T10:00:00-03:00"),
  ];

  it("C11_rows_as_drawn_one_per_invoice_text", () => {
    const rows = deparaRows(lines);
    expect(rows.map((r) => [r.description, r.ingredient, r.how, r.price, r.state])).toEqual([
      ["CARNE BOV MOIDA PATINHO/ACEM 80/20 KG", "Carne bovina moída (blend)", "regra: texto + NCM 0201", "R$ 38,90/kg", "auto"],
      ["REFRIG COCA COLA LT 350ML", "Refrigerante lata 350 ml", "código de barras", "R$ 2,85/un", "auto"],
      ["QJO PROC CHED FAT 2,27KG 160FT", "Queijo cheddar fatiado", "sugestão da IA", "R$ 52,10/kg", "suggested"],
      ["PAO HAMB BRIOCHE GERG C/12", "Pão brioche", "sugestão da IA", "R$ 1,15/un", "suggested"],
      ["GAS GLP P13", "sem par", "", "", "none"],
    ]);
    expect(rows[0].lineIds).toEqual(["1", "6"]);
  });

  it("D02_C11_shares_count_suggestions_apart_from_matched_spend", () => {
    const total = 38900 + 28500 + 23654 + 13800 + 11500 + 19450;
    const s = spendShares(lines);
    expect(s).toEqual({
      auto: Math.round(((38900 + 28500 + 19450) * 100) / total),
      ai: Math.round(((23654 + 13800) * 100) / total),
      none: Math.round((11500 * 100) / total),
    });
  });

  it("C11_how_labels", () => {
    expect(howLabel({ method: "rule", rule: { ncm_prefix: null, unit: "PC" } })).toBe("regra: texto + unidade");
    expect(howLabel({ method: "manual", rule: null })).toBe("escolhido no console");
  });

  it("CST01_line_price_per_base_unit", () => {
    expect(unitPriceLabel(linePricePerBase(75600, 100, 900), "ml")).toBe("R$ 8,40/l");
  });
});
