// E05, 06 §7: the manual WhatsApp queue holds owner messages in quiet hours; team alerts are not held.
import { describe, expect, it } from "vitest";
import { buildManualRows, manualState, type ManualRecord } from "./manual-queue";

const sp = (iso: string) => new Date(`${iso}-03:00`);
const row = (over: Partial<ManualRecord> = {}): ManualRecord => ({
  id: "n1",
  account_id: "acc",
  person_id: "dono",
  notice_code: "deadline_soon",
  alert_id: null,
  status: "queued",
  body: "Faltam 3 dias",
  recipient: "+5543900001234",
  provider_id: null,
  created_at: "2026-10-30T12:00:00Z",
  manual_sent_at: null,
  ...over,
});
const names = {
  people: new Map([["dono", "Dono do grupo"]]),
  accounts: new Map([["acc", { code: "G-02", name: "Grupo Exemplo" }]]),
  notices: new Map([["deadline_soon", "Prazo de contestação chegando"]]),
  alerts: new Map([["al", "Importação da API falhou 2 vezes"]]),
};

describe("E05 manual WhatsApp queue", () => {
  it("E05_quiet_hours_hold_owner_whatsapp_in_the_console_queue", () => {
    expect(manualState(row(), sp("2026-10-30T14:00:00"))).toBe("ready");
    expect(manualState(row(), sp("2026-10-30T22:00:00"))).toBe("held");
    expect(manualState(row(), sp("2026-10-31T07:59:00"))).toBe("held");
    expect(manualState(row({ status: "held_quiet_hours" }), sp("2026-10-31T08:00:00"))).toBe("ready");
  });

  it("E05_team_alert_whatsapp_to_the_founder_on_duty_is_not_held", () => {
    expect(manualState(row({ notice_code: null, alert_id: "al" }), sp("2026-10-30T23:30:00"))).toBe("ready");
  });

  it("a row without number cannot be sent; a marked row is done", () => {
    expect(manualState(row({ recipient: null }), sp("2026-10-30T14:00:00"))).toBe("no_number");
    expect(manualState(row({ manual_sent_at: "2026-10-30T15:00:00Z" }), sp("2026-10-30T14:00:00"))).toBe("done");
  });

  it("rows carry the click-to-chat link only when the founder may send", () => {
    const [ready] = buildManualRows([row()], names, sp("2026-10-30T14:00:00"));
    expect(ready).toMatchObject({
      to: "Dono do grupo · +5543900001234",
      client: "Grupo Exemplo (G-02)",
      notice: "Prazo de contestação chegando",
      state: "ready",
      link: `https://wa.me/5543900001234?text=${encodeURIComponent("Faltam 3 dias")}`,
      since: "30/out 09:00",
    });
    const [held] = buildManualRows([row()], names, sp("2026-10-30T23:00:00"));
    expect(held).toMatchObject({ state: "held", link: null });
    const [alert] = buildManualRows([row({ notice_code: null, alert_id: "al" })], names, sp("2026-10-30T14:00:00"));
    expect(alert.notice).toBe("Alerta: Importação da API falhou 2 vezes");
  });
});
