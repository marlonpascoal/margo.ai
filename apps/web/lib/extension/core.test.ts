// P04 server side, pure parts: pairing code, token, requested reports, upload limits (06 §9).
import { describe, expect, it } from "vitest";
import { bearer, checkUpload, generatePairingCode, generateToken, MAX_UPLOAD_BYTES, normalizePairingCode, previousMonthLabel, requestedReports, sha256Hex } from "./core";

describe("P04 pairing", () => {
  it("codes are 4-4 from an alphabet without look-alikes", () => {
    for (let i = 0; i < 50; i++) expect(generatePairingCode()).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
    expect(generatePairingCode(() => 0)).toBe("AAAA-AAAA");
  });

  it("what the owner types is normalized before hashing", () => {
    expect(normalizePairingCode(" k7m4 q9tx ")).toBe("K7M4-Q9TX");
    expect(normalizePairingCode("K7M4-Q9TX")).toBe("K7M4-Q9TX");
    expect(normalizePairingCode("K7M4")).toBeNull();
    expect(sha256Hex("GSYN-PAR1")).toHaveLength(64);
  });

  it("tokens are long, random and read from the Bearer header only", () => {
    const a = generateToken();
    expect(a).toMatch(/^mgx_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(generateToken());
    expect(bearer(`Bearer ${a}`)).toBe(a);
    expect(bearer(a)).toBeNull();
    expect(bearer(null)).toBeNull();
  });
});

describe("P04 requested reports, as drawn", () => {
  it("last month in São Paulo, as drawn", () => {
    const now = new Date("2026-10-31T02:00:00Z"); // 30/out 23:00 in São Paulo
    expect(previousMonthLabel(now)).toBe("set/2026");
    expect(previousMonthLabel(new Date("2027-01-10T12:00:00Z"))).toBe("dez/2026");
    expect(requestedReports(now)).toEqual([
      { key: "vendas_por_item", name: "Vendas por item", period: "set/2026 · a API não traz este", requested: true },
      { key: "promocoes", name: "Extrato de promoções e campanhas", period: "set/2026", requested: true },
      { key: "avaliacoes", name: "Avaliações da loja", period: "não precisamos agora", requested: false },
    ]);
  });
});

describe("P04 upload limits", () => {
  it("csv and xlsx up to 20 MB", () => {
    expect(checkUpload("conciliacao.csv", 1000)).toEqual({ ok: true, ext: "csv" });
    expect(checkUpload("Vendas.XLSX", 1000)).toEqual({ ok: true, ext: "xlsx" });
    expect(checkUpload("relatorio.pdf", 1000)).toMatchObject({ ok: false, status: 415 });
    expect(checkUpload("csv", 1000)).toMatchObject({ ok: false, status: 415 });
    expect(checkUpload("conciliacao.csv", MAX_UPLOAD_BYTES + 1)).toMatchObject({ ok: false, status: 413 });
  });
});
