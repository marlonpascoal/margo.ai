// B01 P23 "Oportunidades" block: the AI line, the opportunities in order with their items; nothing for a competitor,
// for no data or for an empty list. SINTÉTICO names.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Opportunities as Data } from "@/lib/monitor/load";
import Opportunities from "./Opportunities";

const data: Data = {
  xray_id: "x",
  created_at: "2026-11-08T10:00:00Z",
  model: "m",
  prompt_version: "oportunidades.v1",
  dropped: 1,
  items: [
    { rank: 1, title: "Suba o X-Burger Sintético para R$ 29,00", why: "Está 17% abaixo do meio. Subir pode vender menos.", lever: "subir_preco", items: [{ item_id: "a", name: "X-Burger Sintético" }] },
    { rank: 2, title: "Acompanhe as porções", why: "Volte no próximo raio-X.", lever: "acompanhar", items: [] },
  ],
};

const html = (d: Data | null, competitor = false) => renderToStaticMarkup(createElement(Opportunities, { data: d, competitor }));

describe("B01 P23 Oportunidades", () => {
  it("B01_opportunities_block_shows_the_ai_line_and_the_items_in_order", () => {
    const h = html(data);
    expect(h).toContain("Oportunidades");
    expect(h).toContain("Sugestão gerada por IA a partir dos números deste raio-X. Confira antes de mudar preços.");
    expect(h.indexOf("Suba o X-Burger")).toBeLessThan(h.indexOf("Acompanhe as porções"));
    expect(h).toContain("<li>X-Burger Sintético</li>");
    expect(h).toContain("Subir preço");
    expect(h).not.toContain("—");
  });

  it("B01_opportunities_block_is_empty_for_a_competitor_no_data_or_none_valid", () => {
    expect(html(data, true)).toBe("");
    expect(html(null)).toBe("");
    expect(html({ ...data, items: [] })).toBe("");
  });
});
