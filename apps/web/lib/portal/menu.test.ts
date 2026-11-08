import { describe, expect, it } from "vitest";
import { accountChip, ownerMenu } from "./menu";

describe("owner top menu (design/MenuDono.dc.html)", () => {
  it("MenuDono_dono_sees_the_seven_entries_in_order", () => {
    expect(ownerMenu("dono").map((i) => i.label)).toEqual([
      "Início",
      "Lojas",
      "Contestações",
      "Pessoas",
      "Plano e cobrança",
      "Notificações",
      "Segurança",
    ]);
  });

  it("MenuDono_plan_is_dono_only", () => {
    expect(ownerMenu("financeiro").map((i) => i.code)).not.toContain("W05");
    expect(ownerMenu("gerente").map((i) => i.code)).not.toContain("W05");
  });

  it("B01_MenuDono_raio_x_between_inicio_and_lojas_only_with_m1_portal", () => {
    expect(ownerMenu("dono", { raioX: true }).map((i) => i.label).slice(0, 3)).toEqual(["Início", "Raio-X", "Lojas"]);
    expect(ownerMenu("gerente", { raioX: true }).map((i) => i.href)).toContain("/app/raio-x");
    expect(ownerMenu("dono").map((i) => i.code)).not.toContain("W10");
  });

  it("MenuDono_account_chip", () => {
    expect(accountChip("Grupo Exemplo", 2)).toBe("Grupo Exemplo · 2 cozinhas");
    expect(accountChip("Pantanos Burguer", 1)).toBe("Pantanos Burguer · 1 cozinha");
  });
});
