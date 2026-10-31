import { describe, expect, it } from "vitest";
import { dayMonth, joinPt, monthStartSaoPaulo, plural } from "./format";

describe("formats", () => {
  it("day_and_month_in_sao_paulo", () => {
    expect(dayMonth(new Date("2026-10-29T15:00:00-03:00"))).toBe("29/out");
    // 01:00 UTC on 1/nov is still 31/out in São Paulo.
    expect(dayMonth(new Date("2026-11-01T01:00:00Z"))).toBe("31/out");
  });

  it("month_start_in_sao_paulo", () => {
    expect(monthStartSaoPaulo(new Date("2026-10-30T12:00:00-03:00"))).toBe("2026-10-01T03:00:00.000Z");
    expect(monthStartSaoPaulo(new Date("2026-11-01T01:00:00Z"))).toBe("2026-10-01T03:00:00.000Z");
  });

  it("joins_and_plurals", () => {
    expect(joinPt(["iFood"])).toBe("iFood");
    expect(joinPt(["iFood", "99Food"])).toBe("iFood e 99Food");
    expect(joinPt(["a", "b", "c"])).toBe("a, b e c");
    expect(plural(1, "loja", "lojas")).toBe("1 loja");
    expect(plural(6, "loja", "lojas")).toBe("6 lojas");
  });
});
