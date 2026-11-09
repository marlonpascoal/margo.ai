// The collected menu screen (console). Fixtures are SINTÉTICO.
import { describe, expect, it } from "vitest";
import { capturedAtLabel, choiceRuleLabel, menuView, optionPriceLabel, originalPriceLabel, priceLabel, sizeLabel, type MenuRow } from "./menu";

const row = (over: Partial<MenuRow>): MenuRow => ({
  id: "i",
  name: "Item sintético",
  description: null,
  category: "Pratos",
  price_cents: 2000,
  original_price_cents: null,
  minimum_price_cents: null,
  unit: "un",
  unit_qty: null,
  unit_from_name: false,
  item_type: null,
  choices: null,
  collected_at: "2026-11-08T12:00:00Z",
  ...over,
});
const CHOICE = { name: "Proteína", min: 1, max: 1, options: [{ name: "Frango", price_cents: 0 }] };

describe("M1 collected menu", () => {
  it("M1_menu_groups_by_section_in_order_and_leaves_no_section_last", () => {
    const v = menuView([row({ id: "b", name: "Bife", category: "Pratos" }), row({ id: "a", name: "Arroz", category: "Pratos" }), row({ id: "s", category: null }), row({ id: "e", category: "Água e bebidas" })]);
    expect(v.sections.map((s) => s.name)).toEqual(["Água e bebidas", "Pratos", "Sem seção"]);
    expect(v.sections[1]!.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("M1_menu_counts_items_complements_and_the_latest_collection", () => {
    const v = menuView([row({ id: "a", choices: [CHOICE] }), row({ id: "b", collected_at: "2026-11-09T02:13:06Z" })]);
    expect(v.total).toBe(2);
    expect(v.withChoices).toBe(1);
    expect(v.lastCollectedAt).toBe("2026-11-09T02:13:06Z");
    expect(v.sections[0]!.items[0]!.groups).toEqual([CHOICE]);
  });

  it("M1_menu_empty_has_no_date", () => {
    expect(menuView([])).toEqual({ total: 0, withChoices: 0, lastCollectedAt: null, sections: [] });
  });

  it("M1_menu_price_reads_the_variable_price_as_drawn_by_the_channel", () => {
    expect(priceLabel(row({ price_cents: 2790 }))).toBe("R$ 27,90");
    expect(priceLabel(row({ price_cents: 0, minimum_price_cents: 1900 }))).toBe("a partir de R$ 19,00");
    expect(priceLabel(row({ price_cents: 0 }))).toBe("sem preço");
  });

  it("M1_menu_shows_the_price_before_a_promotion_only_when_higher", () => {
    expect(originalPriceLabel(row({ price_cents: 1000, original_price_cents: 1200 }))).toBe("de R$ 12,00");
    expect(originalPriceLabel(row({ price_cents: 1000, original_price_cents: 1000 }))).toBeNull();
    expect(originalPriceLabel(row({}))).toBeNull();
  });

  it("M1_menu_size_only_when_known", () => {
    expect(sizeLabel(row({ unit: "g", unit_qty: 300 }))).toBe("300 g");
    expect(sizeLabel(row({ unit: "ml", unit_qty: 1500 }))).toBe("1500 ml");
    expect(sizeLabel(row({ unit: "un", unit_qty: 8 }))).toBe("8 un");
    expect(sizeLabel(row({ unit: "pack", unit_qty: 6 }))).toBe("pack de 6");
    expect(sizeLabel(row({}))).toBeNull();
    expect(sizeLabel(row({ unit: "ml", unit_qty: 350, unit_from_name: true }))).toBeNull();
  });

  it("M1_menu_says_the_rule_of_each_group_and_what_each_option_adds", () => {
    expect(choiceRuleLabel(0, 20)).toBe("opcional, até 20");
    expect(choiceRuleLabel(1, 1)).toBe("obrigatório, escolha 1");
    expect(choiceRuleLabel(1, 3)).toBe("obrigatório, de 1 a 3");
    expect(optionPriceLabel(0)).toBe("incluso");
    expect(optionPriceLabel(99)).toBe("+ R$ 0,99");
  });

  it("M1_menu_date_is_in_sao_paulo", () => {
    expect(capturedAtLabel("2026-11-09T02:13:06Z")).toBe("08/11/2026 às 23:13");
  });

  it("M1_menu_ignores_stored_choices_that_are_not_a_list", () => {
    expect(menuView([row({ choices: { x: 1 } })]).sections[0]!.items[0]!.groups).toEqual([]);
  });
});
