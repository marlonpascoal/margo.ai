import { describe, expect, it } from "vitest";
import { cnpjCheckDigits, formatCnpj, validCnpj } from "./cnpj";
import { accessWhen, deviceName, deviceWhen, kitchenShort, maskWhatsapp, parseWhatsapp, trialDaysLeft, trialUsedPct } from "./format";

// A synthetic CNPJ built at run time (no document literal in git, scripts/secret_scan.py).
const base = "112223330001";
const good = base + cnpjCheckDigits(base);

describe("P07 CNPJ check digits", () => {
  it("P07_valid_cnpj_accepts_correct_check_digits_with_or_without_punctuation", () => {
    expect(validCnpj(good)).toBe(true);
    expect(validCnpj(formatCnpj(good))).toBe(true);
  });

  it("P07_valid_cnpj_refuses_wrong_digits_repeated_digits_and_wrong_length", () => {
    const wrong = good.slice(0, 13) + String((Number(good[13]) + 1) % 10);
    expect(validCnpj(wrong)).toBe(false);
    expect(validCnpj("11111111111111")).toBe(false);
    expect(validCnpj(good.slice(0, 13))).toBe(false);
    expect(validCnpj("")).toBe(false);
  });

  it("P07_format_cnpj", () => {
    expect(formatCnpj(good)).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
  });
});

describe("portal formats", () => {
  it("W08_W09_mask_whatsapp_keeps_ddd_and_last_four", () => {
    expect(maskWhatsapp("+5543900001234")).toBe("(43) 9 ••••-1234");
    expect(maskWhatsapp(null)).toBe("");
  });

  it("P07_parse_whatsapp_to_e164", () => {
    expect(parseWhatsapp("(43) 9 1234-5678")).toBe("+5543912345678");
    expect(parseWhatsapp("+55 43 91234-5678")).toBe("+5543912345678");
    expect(parseWhatsapp("1234")).toBeNull();
    expect(parseWhatsapp("")).toBeNull();
  });

  it("W01_P08_trial_days_left_counts_sao_paulo_calendar_days", () => {
    const ends = new Date("2026-11-08T23:59:59-03:00");
    expect(trialDaysLeft(ends, new Date("2026-10-30T10:00:00-03:00"))).toBe(9);
    expect(trialDaysLeft(ends, new Date("2026-11-08T22:00:00-03:00"))).toBe(0);
    expect(trialDaysLeft(ends, new Date("2026-11-09T09:00:00-03:00"))).toBe(0);
    expect(trialUsedPct(9, 14)).toBe(36);
  });

  it("W09_device_name_from_user_agent", () => {
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("Chrome no Mac");
    expect(deviceName("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Celular Android");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("Chrome no Windows");
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toBe("iPhone");
    expect(deviceName(null)).toBe("Aparelho");
  });

  it("W09_relative_times_in_sao_paulo", () => {
    const now = new Date("2026-10-30T12:00:00-03:00");
    expect(accessWhen(new Date("2026-10-30T08:12:00-03:00"), now)).toBe("hoje 08:12");
    expect(accessWhen(new Date("2026-10-29T17:40:00-03:00"), now)).toBe("ontem 17:40");
    expect(accessWhen(new Date("2026-10-29T10:02:00-03:00"), new Date("2026-10-31T09:00:00-03:00"))).toBe("29/out 10:02");
    expect(deviceWhen(new Date("2026-10-29T21:10:00-03:00"), now)).toBe("ontem 21:10");
    expect(deviceWhen(new Date("2026-10-27T19:30:00-03:00"), now)).toBe("27/out");
  });

  it("W01_kitchen_short_name_as_drawn", () => {
    expect(kitchenShort("Cozinha Centro")).toBe("Centro");
    expect(kitchenShort("Quiosque Shopping")).toBe("Quiosque Shopping");
  });
});
