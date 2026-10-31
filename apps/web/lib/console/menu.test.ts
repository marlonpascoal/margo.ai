import { describe, expect, it } from "vitest";
import { consoleMenu } from "./menu";

const codes = (role: "fundador" | "operacao") => consoleMenu(role).flatMap((g) => g.items.map((i) => i.code));

describe("console sidebar (design/Menu.dc.html)", () => {
  it("Menu_fundador_sees_every_group_in_drawing_order", () => {
    expect(consoleMenu("fundador").map((g) => g.title)).toEqual([
      "Clientes e cobrança",
      "Módulo 1 · raio-X",
      "Módulo 2 · canais",
      "Módulo 3 · custo",
      "",
    ]);
    expect(codes("fundador")).toEqual([
      "C21", "C01", "C15", "C19", "C18",
      "C02", "C03", "C04", "C05", "C06",
      "C07", "C17", "C08", "C09", "C16",
      "C10", "C11", "C12", "C13",
      "C14", "C20",
    ]);
  });

  it("Menu_C00_operacao_never_sees_C14_C15_C20", () => {
    const list = codes("operacao");
    for (const hidden of ["C14", "C15", "C20"]) expect(list).not.toContain(hidden);
    expect(list).toContain("C01");
    // The last group holds only C14 and C20, so it disappears for Operação.
    expect(consoleMenu("operacao").map((g) => g.title)).not.toContain("");
  });

  it("Menu_links_screens_that_need_an_account_only_with_one", () => {
    const find = (code: string, ctx = {}) => consoleMenu("fundador", ctx).flatMap((g) => g.items).find((i) => i.code === code)!;
    expect(find("C01").href).toBe("/console");
    expect(find("C14").href).toBe("/console/config");
    expect(find("C19").href).toBeNull();
    expect(find("C19", { accountCode: "G-02" }).href).toBe("/console/contas/G-02/estrutura");
    expect(find("C09", { accountCode: "G-02", month: "2026-09" }).href).toBe("/console/contas/G-02/fechamento/2026-09/diferencas");
  });
});
