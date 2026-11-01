// E05: which notification rows a notice becomes for one person (04 §9). Pure, fake clock.
import { describe, expect, it } from "vitest";
import { effectivePref, isQuietHours, planNotice, waitsForMorning, whatsappLink, type NoticeType, type Recipient } from "./plan";

// As seeded by 20261031000003_reference_data.sql.
const T: Record<string, NoticeType> = {
  close_ready: { code: "close_ready", name: "Fechamento do mês pronto", audienceRoles: ["dono", "financeiro"], emailLocked: false, defaultEmail: true, defaultWhatsapp: true },
  new_difference: { code: "new_difference", name: "Diferença nova no repasse", audienceRoles: ["dono", "financeiro"], emailLocked: false, defaultEmail: true, defaultWhatsapp: false },
  invoices_missing: { code: "invoices_missing", name: "Notas faltando", audienceRoles: ["dono", "financeiro"], emailLocked: false, defaultEmail: false, defaultWhatsapp: true },
  weekly_summary: { code: "weekly_summary", name: "Resumo da semana", audienceRoles: ["dono", "financeiro", "gerente"], emailLocked: false, defaultEmail: true, defaultWhatsapp: false },
  billing_result: { code: "billing_result", name: "Cobrança aprovada ou recusada", audienceRoles: ["dono"], emailLocked: true, defaultEmail: true, defaultWhatsapp: false },
  security_event: { code: "security_event", name: "Pessoa nova ou login em aparelho novo", audienceRoles: ["dono"], emailLocked: true, defaultEmail: true, defaultWhatsapp: false },
  trial_ending: { code: "trial_ending", name: "Teste grátis acabando", audienceRoles: ["dono"], emailLocked: true, defaultEmail: true, defaultWhatsapp: true },
};

const dono: Recipient = {
  personId: "p-dono", accountId: "acc", accountName: "Grupo Exemplo", role: "dono",
  email: "dono@exemplo.com.br", whatsappE164: "+5543912341234",
};
const gerente: Recipient = { ...dono, personId: "p-ger", role: "gerente", email: "gerente@exemplo.com.br" };
const msg = { subject: "Assunto", body: "Corpo do e-mail.", whatsapp: "Texto do WhatsApp." };

// 14:00 in São Paulo (UTC-3, no daylight saving since 2019).
const DAY = new Date("2026-11-05T17:00:00Z");
const sp = (hhmm: string) => new Date(`2026-11-05T${hhmm}:00-03:00`);

const channels = (rows: { channel: string; status: string }[]) => rows.map((r) => `${r.channel}:${r.status}`);

describe("E05 preferences", () => {
  it("E05_preferences_respected_over_defaults", () => {
    // close_ready defaults to both; this person turned e-mail off.
    const rows = planNotice(T.close_ready, dono, { email: false, whatsapp: true }, msg, DAY);
    expect(channels(rows)).toEqual(["whatsapp_manual:queued"]);
    expect(rows[0]).toMatchObject({ personId: "p-dono", accountId: "acc", noticeCode: "close_ready", subject: null, body: "Texto do WhatsApp.", recipient: "+5543912341234" });
  });

  it("E05_notice_defaults_when_the_person_has_no_preference", () => {
    expect(channels(planNotice(T.new_difference, dono, null, msg, DAY))).toEqual(["email:queued"]);
    expect(channels(planNotice(T.invoices_missing, dono, null, msg, DAY))).toEqual(["whatsapp_manual:queued"]);
    expect(channels(planNotice(T.close_ready, dono, null, msg, DAY))).toEqual(["email:queued", "whatsapp_manual:queued"]);
  });

  it("E05_both_channels_off_sends_nothing", () => {
    expect(planNotice(T.close_ready, dono, { email: false, whatsapp: false }, msg, DAY)).toEqual([]);
  });

  it("E05_only_the_audience_roles_receive_a_notice", () => {
    expect(planNotice(T.close_ready, gerente, null, msg, DAY)).toEqual([]);
    expect(channels(planNotice(T.weekly_summary, gerente, null, msg, DAY))).toEqual(["email:queued"]);
  });

  it("E05_missing_contact_skips_that_channel", () => {
    const noPhone = { ...dono, whatsappE164: null };
    expect(channels(planNotice(T.close_ready, noPhone, null, msg, DAY))).toEqual(["email:queued"]);
  });

  it("E05_email_row_carries_subject_body_and_address", () => {
    const [row] = planNotice(T.new_difference, dono, null, msg, DAY);
    expect(row).toMatchObject({ channel: "email", subject: "Assunto", body: "Corpo do e-mail.", recipient: "dono@exemplo.com.br" });
  });
});

describe("E05 locked notices", () => {
  it.each(["billing_result", "security_event", "trial_ending"])("E05_locked_notice_%s_always_by_email", (code) => {
    // Even a stored "off" (the database trigger refuses it; this is defense in depth) gives e-mail.
    expect(effectivePref(T[code], { email: false, whatsapp: false }).email).toBe(true);
    const rows = planNotice(T[code], dono, { email: false, whatsapp: false }, msg, DAY);
    expect(channels(rows)).toEqual(["email:queued"]);
  });

  it("E05_locked_notice_still_honors_the_whatsapp_choice", () => {
    expect(channels(planNotice(T.trial_ending, dono, null, msg, DAY))).toEqual(["email:queued", "whatsapp_manual:queued"]);
    expect(channels(planNotice(T.billing_result, dono, { email: true, whatsapp: true }, msg, DAY))).toEqual(["email:queued", "whatsapp_manual:queued"]);
  });
});

describe("E05 quiet hours", () => {
  it("E05_quiet_hours_are_22h_to_8h_sao_paulo", () => {
    expect(isQuietHours(sp("21:59"))).toBe(false);
    expect(isQuietHours(sp("22:00"))).toBe(true);
    expect(isQuietHours(sp("03:00"))).toBe(true);
    expect(isQuietHours(sp("07:59"))).toBe(true);
    expect(isQuietHours(sp("08:00"))).toBe(false);
    // 23:30 UTC is 20:30 in São Paulo: not quiet, whatever the server's own zone says.
    expect(isQuietHours(new Date("2026-11-05T23:30:00Z"))).toBe(false);
  });

  it("E05_only_urgent_team_alerts_by_whatsapp_break_quiet_hours", () => {
    // Marlon, 31/out: urgent alerts to the founder on duty go at any hour; every other WhatsApp waits; e-mail never waits.
    expect(waitsForMorning({ channel: "whatsapp_manual", alertSeverity: "urgente" })).toBe(false);
    expect(waitsForMorning({ channel: "whatsapp", alertSeverity: "urgente" })).toBe(false);
    expect(waitsForMorning({ channel: "whatsapp_manual", alertSeverity: "medio" })).toBe(true);
    expect(waitsForMorning({ channel: "whatsapp_manual", alertSeverity: "baixo" })).toBe(true);
    expect(waitsForMorning({ channel: "whatsapp_manual", alertSeverity: null })).toBe(true);
    expect(waitsForMorning({ channel: "whatsapp", alertSeverity: null })).toBe(true);
    expect(waitsForMorning({ channel: "email", alertSeverity: null })).toBe(false);
    expect(waitsForMorning({ channel: "email", alertSeverity: "baixo" })).toBe(false);
  });

  it("E05_quiet_hours_hold_whatsapp_and_let_email_go", () => {
    const rows = planNotice(T.close_ready, dono, null, msg, sp("23:30"));
    expect(channels(rows)).toEqual(["email:queued", "whatsapp_manual:held_quiet_hours"]);
  });
});

describe("click-to-chat link (D36)", () => {
  it("builds a wa.me link with the number digits and the encoded text", () => {
    expect(whatsappLink("+5543912341234", "Olá, tudo bem? R$ 640 & mais")).toBe(
      "https://wa.me/5543912341234?text=Ol%C3%A1%2C%20tudo%20bem%3F%20R%24%20640%20%26%20mais",
    );
  });
});
