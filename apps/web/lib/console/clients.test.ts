import { describe, expect, it } from "vitest";
import { clientRow, ifoodConnectedCount, m2Status, placeLine, type AccountFacts } from "./clients";

const pantanos: AccountFacts = {
  id: "1",
  name: "Pantanos Burguer",
  code: "G-01",
  isSynthetic: true,
  kitchens: [{ name: "Igapó", city: "Londrina" }],
  stores: [{ channel: "ifood", authorized: true, source: "public", kitchenId: "k" }],
};
const exemplo: AccountFacts = {
  id: "2",
  name: "Grupo Exemplo",
  code: "G-02",
  isSynthetic: true,
  kitchens: [
    { name: "Cozinha Centro", city: "São Paulo" },
    { name: "Cozinha Zona Sul", city: "São Paulo" },
  ],
  stores: [
    { channel: "food99", authorized: true, source: "file", kitchenId: "k1" },
    { channel: "ifood", authorized: true, source: "api", kitchenId: "k1" },
    { channel: "ifood", authorized: true, source: "api", kitchenId: null },
  ],
};
const empty: AccountFacts = { id: "3", name: "Grupo C", code: "G-04", isSynthetic: false, kitchens: [], stores: [] };

describe("C01 rows from data", () => {
  it("C01_module2_status_comes_from_channel_stores", () => {
    expect(m2Status(pantanos.stores).label).toBe("Autorização pendente");
    expect(m2Status(exemplo.stores).label).toBe("Conectado · iFood e 99Food");
    expect(m2Status([]).label).toBe("Não iniciado");
  });

  it("C01_place_line_and_linked_store_count", () => {
    expect(placeLine(pantanos.kitchens)).toBe("Igapó, Londrina");
    expect(placeLine(exemplo.kitchens)).toBe("São Paulo");
    expect(clientRow(pantanos).detail).toBe("Igapó, Londrina · 1 loja");
    // The store without a kitchen does not count (D29).
    expect(clientRow(exemplo).detail).toBe("São Paulo · 2 lojas");
    expect(clientRow(empty).detail).toBe("");
  });

  it("C01_next_step_follows_module_status", () => {
    expect(clientRow(pantanos).next).toBe("Cobrar a autorização no iFood");
    expect(clientRow(exemplo).next).toBe("Revisar diferenças");
    expect(clientRow(empty).next).toBe("Rodar o raio-X");
  });

  it("C01_ifood_connected_ignores_public_only_stores", () => {
    expect(ifoodConnectedCount([pantanos, exemplo, empty])).toBe(1);
  });

  it("C01_row_names_carry_the_client_code", () => {
    expect(clientRow(exemplo).name).toBe("Grupo Exemplo (código G-02)");
    expect(clientRow(exemplo).href).toBe("/console/contas/G-02/estrutura");
  });
});
