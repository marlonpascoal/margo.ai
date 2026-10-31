import { describe, expect, it } from "vitest";
import { canConsole, canConsoleScreen, canPortal, consoleScreenArea, portalScreenAllowed } from "./permissions";

describe("console matrix (04 §5)", () => {
  it("C00_fundador_can_use_every_console_area", () => {
    for (const area of ["clients", "billing", "settings", "flags"] as const) expect(canConsole("fundador", area)).toBe(true);
  });

  it("C00_operacao_never_sees_C14_C15_C20", () => {
    expect(canConsole("operacao", "clients")).toBe(true);
    for (const code of ["C14", "C15", "C20"]) expect(canConsoleScreen("operacao", code)).toBe(false);
    for (const code of ["C01", "C02", "C07", "C10", "C16", "C18", "C19", "C21"]) {
      expect(canConsoleScreen("operacao", code)).toBe(true);
    }
  });

  it("no_role_means_no_console", () => {
    expect(canConsole(null, "clients")).toBe(false);
    expect(canConsoleScreen(null, "C01")).toBe(false);
  });

  it("every_console_screen_has_an_area", () => {
    const codes = Array.from({ length: 22 }, (_, i) => `C${String(i).padStart(2, "0")}`);
    for (const code of codes) expect(consoleScreenArea(code)).toBeDefined();
  });
});

describe("owner portal matrix (04 §5)", () => {
  it("dono_can_do_everything", () => {
    for (const a of ["see_close", "contestations", "send_invoices", "see_xray", "choose_kitchens", "billing", "people", "delete_account"] as const) {
      expect(canPortal("dono", a)).toBe(true);
    }
  });

  it("financeiro_and_gerente_cannot_touch_plan_people_or_delete", () => {
    for (const role of ["financeiro", "gerente"] as const) {
      expect(canPortal(role, "see_close")).toBe(true);
      expect(canPortal(role, "choose_kitchens")).toBe(false);
      expect(canPortal(role, "billing")).toBe(false);
      expect(canPortal(role, "people")).toBe(false);
      expect(canPortal(role, "delete_account")).toBe(false);
    }
  });

  it("only_dono_sees_plan_in_the_owner_menu", () => {
    expect(portalScreenAllowed("dono", "W05")).toBe(true);
    expect(portalScreenAllowed("financeiro", "W05")).toBe(false);
    expect(portalScreenAllowed("gerente", "W04")).toBe(true);
  });
});
