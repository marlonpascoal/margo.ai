// Pure parts of C12, C13, W01 (M3): labels and sentences against the drawn values.
import { describe, expect, it } from "vitest";
import { MINUS } from "@/lib/m2/format";
import {
  c13Cells,
  decisionC13,
  decisionW01,
  errorExplanation,
  errorNote,
  money2,
  qtyLabel,
  rowLabel,
  sourceLabel,
  yieldLabel,
  type ContributionRecord,
  type DecisionRecord,
} from "./format";

describe("C12 ficha técnica", () => {
  it("CST-03 line labels as drawn", () => {
    expect(qtyLabel(160, "g")).toBe("160 g");
    expect(qtyLabel(1, "un")).toBe("1 un");
    expect(qtyLabel(12.5, "ml")).toBe("12,5 ml");
    expect(yieldLabel(0.85)).toBe("85%");
    expect(yieldLabel(1)).toBe("100%");
    expect(money2(1244)).toBe("12,44");
    expect(money2(-941)).toBe(`${MINUS}9,41`);
  });

  it("CST-01 and CST-02 price source as drawn", () => {
    expect(sourceLabel("invoice", "2026-10-12", 55)).toBe("nota de 12/out");
    expect(sourceLabel("invoice", "2026-10-03", 65)).toBe("cupom de 03/out");
    expect(sourceLabel("regional_prior", "2026-10-01", null)).toBe(
      "estimativa regional",
    );
    expect(sourceLabel(null, null, null)).toBe("sem preço");
  });

  it("CST-04 error bar explanation as drawn", () => {
    const xbacon = [
      { confidence: "declarado", source: "invoice" },
      { confidence: "medido", source: "invoice" },
      { confidence: "medido", source: "regional_prior" },
      { confidence: "medido", source: "invoice" },
      { confidence: "medido", source: "invoice" },
      { confidence: "medido", source: "regional_prior" },
    ] as const;
    expect(errorExplanation([...xbacon])).toBe(
      "A barra de erro vem do rendimento declarado e dos dois preços que ainda são estimativa regional.",
    );
    expect(
      errorExplanation([{ confidence: "medido", source: "regional_prior" }]),
    ).toBe(
      "A barra de erro vem do rendimento medido e do preço que ainda é estimativa regional.",
    );
    expect(
      errorExplanation([
        { confidence: "estimado", source: "invoice" },
        { confidence: "declarado", source: "invoice" },
      ]),
    ).toBe(
      "A barra de erro vem dos rendimentos declarado e estimado. Todos os preços são de nota.",
    );
    expect(
      errorExplanation([{ confidence: "medido", source: "invoice" }]),
    ).toBe(
      "A barra de erro vem do rendimento medido. Todos os preços são de nota.",
    );
  });
});

const row = (o: Partial<ContributionRecord>): ContributionRecord => ({
  menuItemId: "m",
  name: "X-Bacon artesanal",
  channel: "ifood",
  campaignName: null,
  campaignDiscountPct: null,
  units: 10,
  priceCents: 3690,
  takeCents: 941,
  ingredientCents: 1244,
  packagingCents: 0,
  errorPct: 0.0927,
  leftCents: 1505,
  leftPct: 0.4079,
  canInvert: false,
  ...o,
});

describe("C13 contribuição", () => {
  it("CTB-01 cells as drawn", () => {
    expect(c13Cells(row({}))).toEqual([
      "X-Bacon artesanal",
      "iFood",
      "36,90",
      `${MINUS}9,41`,
      `${MINUS}12,44`,
      "15,05",
      "41%",
    ]);
    const coupon = row({
      name: "Combo casal",
      campaignName: "Cupom 20% cofinanciado",
      campaignDiscountPct: 0.2,
      priceCents: 6392,
      takeCents: 1630,
      ingredientCents: 3180,
      leftCents: 1582,
      leftPct: 0.2475,
    });
    expect(rowLabel(coupon)).toBe("Combo casal, cupom 20%");
    expect(c13Cells(coupon)).toEqual([
      "Combo casal, cupom 20%",
      "iFood",
      "63,92",
      `${MINUS}16,30`,
      `${MINUS}31,80`,
      "15,82",
      "25%",
    ]);
    expect(
      c13Cells(row({ ingredientCents: 1100, packagingCents: 144 }))[4],
    ).toBe(`${MINUS}12,44`);
  });

  it("CTB-02 error note as drawn, and when rows can invert", () => {
    expect(errorNote([row({}), row({ errorPct: 0.02 })])).toBe(
      "Custo com barra de erro de ± 9% (ver ficha técnica). Um erro desse tamanho não inverte nenhuma linha.",
    );
    expect(errorNote([row({ canInvert: true }), row({})])).toBe(
      "Custo com barra de erro de ± 9% (ver ficha técnica). Uma linha pode inverter com um erro desse tamanho: está marcada.",
    );
    expect(
      errorNote([row({ canInvert: true }), row({ canInvert: true })]),
    ).toBe(
      "Custo com barra de erro de ± 9% (ver ficha técnica). 2 linhas podem inverter com um erro desse tamanho: estão marcadas.",
    );
  });

  it("DLV-01 decision sentences as drawn (C13, W01)", () => {
    const d: DecisionRecord = {
      kind: "campaign",
      name: "Combo casal",
      channel: "ifood",
      discountPct: 0.2,
      leftCents: 1582,
      baseLeftCents: 2773,
      month: "2026-09-01",
    };
    expect(decisionC13(d)).toEqual([
      "O cupom de 20% no ",
      "Combo casal",
      " derruba a contribuição de ",
      "R$ 27,73",
      " para ",
      "R$ 15,82",
      " por pedido no iFood.",
    ]);
    expect(decisionW01(d)).toEqual([
      "Uma decisão para outubro.",
      "O cupom de 20% no Combo casal deixa R$ 15,82 por pedido, contra R$ 27,73 sem cupom.",
    ]);
    const low: DecisionRecord = {
      kind: "lowest",
      name: "Refrigerante lata",
      channel: "ifood",
      discountPct: null,
      leftCents: 87,
      baseLeftCents: null,
      month: "2026-12-01",
    };
    expect(decisionC13(low).join("")).toBe(
      "Refrigerante lata deixa só R$ 0,87 por pedido no iFood, a menor sobra entre os itens que mais vendem.",
    );
    expect(decisionW01(low)).toEqual([
      "Uma decisão para janeiro.",
      "Refrigerante lata deixa só R$ 0,87 por pedido no iFood, a menor sobra entre os itens que mais vendem.",
    ]);
  });
});
