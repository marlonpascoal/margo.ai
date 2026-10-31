import { describe, expect, it } from "vitest";
import type { NoticeType } from "@/lib/notify/plan";
import type { HomeDiff } from "./home";
import { closeReadyExample, NOTICE_COPY, noticeRows } from "./notices";

const t = (code: string, roles: NoticeType["audienceRoles"], locked = false, email = true, whatsapp = false): NoticeType => ({
  code,
  name: code,
  audienceRoles: roles,
  emailLocked: locked,
  defaultEmail: email,
  defaultWhatsapp: whatsapp,
});
const types: NoticeType[] = [
  t("close_ready", ["dono", "financeiro"], false, true, true),
  t("weekly_summary", ["dono", "financeiro", "gerente"]),
  t("security_event", ["dono"], true),
];

describe("P16, W08 notification rows (E05)", () => {
  it("W08_lists_the_10_notices_of_04_section_9_in_drawn_order", () => {
    expect(NOTICE_COPY.map(([c]) => c)).toEqual([
      "close_ready",
      "new_difference",
      "deadline_soon",
      "credit_confirmed",
      "data_stale",
      "invoices_missing",
      "weekly_summary",
      "trial_ending",
      "billing_result",
      "security_event",
    ]);
  });

  it("E05_W08_rows_show_the_person_choice_else_the_default", () => {
    const rows = noticeRows(types, new Map([["close_ready", { email: false, whatsapp: true }]]), "dono");
    expect(rows.map((r) => [r.code, r.email, r.whatsapp])).toEqual([
      ["close_ready", false, true],
      ["weekly_summary", true, false],
      ["security_event", true, false],
    ]);
  });

  it("E05_W08_locked_notice_shows_email_on_even_if_a_stored_row_says_off", () => {
    const rows = noticeRows(types, new Map([["security_event", { email: false, whatsapp: false }]]), "dono");
    expect(rows.find((r) => r.code === "security_event")).toMatchObject({ email: true, locked: true });
  });

  it("E05_W08_a_profile_sees_only_the_notices_it_can_receive", () => {
    expect(noticeRows(types, new Map(), "gerente").map((r) => r.code)).toEqual(["weekly_summary"]);
  });
});

describe("W08 Ver exemplo de e-mail", () => {
  it("E01_example_uses_the_person_scope_numbers_kitchens_and_channels", () => {
    const lines = [
      { kitchenId: "k1", kitchenName: "Cozinha Centro", channel: "food99" as const, gross: 100_00, payout: 80_00 },
      { kitchenId: "k1", kitchenName: "Cozinha Centro", channel: "ifood" as const, gross: 300_00, payout: 210_00 },
    ];
    const diffs: HomeDiff[] = [
      { kitchenId: "k1", amount: 12_00, confidence: "certa", status: "a_contestar" },
      { kitchenId: "k1", amount: 99_00, confidence: "duvidosa", status: null },
    ];
    const e = closeReadyExample("Grupo Exemplo", "2026-09-01", lines, diffs);
    expect(e.subject).toBe("Setembro fechado: recebeu R$ 290 de R$ 400");
    expect(e.blocks[0]).toEqual({ kind: "p", text: ["Grupo Exemplo, 1 cozinha, iFood e 99Food."] });
    expect(e.blocks[1]).toMatchObject({ kind: "rows", rows: [{ value: "R$ 400" }, { value: "R$ 290" }, { value: "falta custo" }, { value: "R$ 12" }] });
  });
});
