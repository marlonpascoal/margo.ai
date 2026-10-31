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

  it("MenuDono_account_chip", () => {
    expect(accountChip("Grupo Exemplo", 2)).toBe("Grupo Exemplo · 2 cozinhas");
    expect(accountChip("Pantanos Burguer", 1)).toBe("Pantanos Burguer · 1 cozinha");
  });
});
