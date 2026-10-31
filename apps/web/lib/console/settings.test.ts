import { describe, expect, it } from "vitest";
import { authorizationRows, scopeText, secretsStatus } from "./settings";

describe("C14 settings", () => {
  it("C14_A06_secrets_status_never_carries_the_value", () => {
    const value = "value-that-must-never-show-42";
    const rows = secretsStatus({ ANTHROPIC_API_KEY: value, IFOOD_CLIENT_ID: "client-id-value-123", SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(JSON.stringify(rows)).not.toContain(value);
    expect(JSON.stringify(rows)).not.toContain("client-id-value-123");
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.IFOOD_CLIENT_ID).toEqual({ name: "IFOOD_CLIENT_ID", where: "Vercel e Maritime", state: "set" });
    expect(byName.IFOOD_CLIENT_SECRET.state).toBe("missing");
    expect(byName.SUPABASE_SERVICE_ROLE_KEY.state).toBe("missing");
    // Lives only on Maritime: this app cannot tell, so it says where, not set or missing.
    expect(byName.ANTHROPIC_API_KEY).toEqual({ name: "ANTHROPIC_API_KEY", where: "Maritime", state: "elsewhere" });
    expect(byName["certificado A1 de cliente"]).toEqual({ name: "certificado A1 de cliente", where: "não guardamos", state: "not_kept" });
  });

  it("C14_scope_text_as_drawn", () => {
    expect(scopeText(["ifood_api", "extensao"])).toBe("iFood (API e extensão)");
    expect(scopeText(["ifood", "food99", "notas"])).toBe("iFood, 99Food, notas");
  });

  it("C14_one_authorization_row_per_cnpj", () => {
    const signedAt = new Date("2026-10-10T11:00:00-03:00");
    const base = { accountName: "Grupo Exemplo", accountCode: "G-02", scope: ["ifood", "food99", "notas"], includesAi: true, signedAt };
    const rows = authorizationRows(
      [
        { ...base, cnpj: "12345678000110" },
        { ...base, cnpj: "12345678000291" },
        { accountName: "Pantanos Burguer", accountCode: "G-01", cnpj: "98765432000150", scope: ["ifood_api", "extensao"], includesAi: true, signedAt: new Date("2026-10-29T15:00:00-03:00") },
      ],
      [
        { name: "Grupo B", code: "G-03", hasConnectedStore: false },
        { name: "Grupo Exemplo", code: "G-02", hasConnectedStore: true },
      ],
    );
    expect(rows).toEqual([
      { title: "Pantanos Burguer (G-01)", detail: "iFood (API e extensão) · IA incluída", status: "assinada 29/out", state: "signed" },
      { title: "Grupo Exemplo (G-02)", detail: "CNPJ final 0001-10 · iFood, 99Food, notas · IA incluída", status: "assinada 10/out", state: "signed" },
      { title: "Grupo Exemplo (G-02)", detail: "CNPJ final 0002-91 · iFood, 99Food, notas · IA incluída", status: "assinada 10/out", state: "signed" },
      { title: "Grupo B (G-03)", detail: "só dado público", status: "não precisa ainda", state: "not_needed" },
    ]);
  });
});
