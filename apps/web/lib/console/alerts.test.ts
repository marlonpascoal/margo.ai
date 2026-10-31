// C21 Alertas (04 §10): open alerts as drawn.
import { describe, expect, it } from "vitest";
import { actionLabel, buildAlertRows, sinceLabel, type AlertRecord } from "./alerts";

const now = new Date("2026-10-30T15:00:00-03:00");
const accounts = new Map([
  ["g02", { code: "G-02", name: "Grupo Exemplo", synthetic: true }],
  ["g01", { code: "G-01", name: "Pantanos Burguer", synthetic: true }],
]);
const alert = (over: Partial<AlertRecord>): AlertRecord => ({
  id: "x",
  severity: "baixo",
  title: "t",
  account_id: null,
  link: null,
  notified_via: ["email_equipe"],
  opened_at: "2026-10-29T06:00:00-03:00",
  ...over,
});

describe("C21 rows", () => {
  it("C21_since_is_hoje_with_time_today_and_day_month_before_in_sao_paulo", () => {
    expect(sinceLabel(new Date("2026-10-30T06:04:00-03:00"), now)).toBe("hoje 06:04");
    expect(sinceLabel(new Date("2026-10-27T09:00:00-03:00"), now)).toBe("27/out");
    // 01:30 UTC on the 30th is still the 29th in São Paulo.
    expect(sinceLabel(new Date("2026-10-30T01:30:00Z"), now)).toBe("29/out");
  });

  it("C21_action_link_labels_follow_the_drawing", () => {
    expect(actionLabel("/console/contas/G-02/importacoes")).toBe("ver importação");
    expect(actionLabel("/console/assinaturas")).toBe("ver assinatura");
    expect(actionLabel("/console/contas/G-01/contestacoes")).toBe("ver contestação");
    expect(actionLabel("/console/importacoes/abc/corrigir")).toBe("corrigir");
    expect(actionLabel("/console/contas/G-02/estrutura")).toBe("vincular");
    expect(actionLabel("/console/outra")).toBe("abrir");
  });

  it("C21_rows_sorted_by_severity_then_since_with_client_and_channels", () => {
    const rows = buildAlertRows(
      [
        alert({ id: "b", severity: "baixo", account_id: "g02", link: "/console/contas/G-02/estrutura" }),
        alert({ id: "m", severity: "medio", account_id: "g01", notified_via: ["email_equipe", "whatsapp_dono"], opened_at: "2026-10-27T09:00:00-03:00" }),
        alert({ id: "u2", severity: "urgente", account_id: "g02", notified_via: ["email_equipe", "email_dono"], opened_at: "2026-10-30T07:10:00-03:00" }),
        alert({ id: "u1", severity: "urgente", account_id: "g02", notified_via: ["team_email", "founder_whatsapp"], opened_at: "2026-10-30T06:04:00-03:00" }),
      ],
      accounts,
      now,
    );
    expect(rows.map((r) => [r.id, r.severityLabel, r.client, r.since, r.via])).toEqual([
      ["u1", "urgente", "Grupo Exemplo (G-02)", "hoje 06:04", "e-mail e WhatsApp da equipe"],
      ["u2", "urgente", "Grupo Exemplo (G-02)", "hoje 07:10", "e-mail da equipe e do dono"],
      ["m", "médio", "Pantanos Burguer (G-01)", "27/out", "e-mail da equipe; WhatsApp do dono"],
      ["b", "baixo", "Grupo Exemplo (G-02)", "29/out", "e-mail da equipe"],
    ]);
    expect(rows[3].action).toEqual({ label: "vincular", href: "/console/contas/G-02/estrutura" });
    expect(rows[0].action).toBeNull();
  });

  it("C21_alert_without_client_has_an_empty_client_cell", () => {
    const [row] = buildAlertRows([alert({ account_id: null })], accounts, now);
    expect(row.client).toBe("");
  });
});
