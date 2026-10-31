// C21, 04 §10: raising and resolving team alerts.
import { beforeEach, describe, expect, it } from "vitest";
import { ALERT_MESSAGES, alertConfigFromEnv, notifiedViaLabel, raiseAlert, resolveAlert, type AlertConfig } from "./alerts";
import { FakeNotifyStore } from "./fake-store";
import { processOutbox, type NotifyDeps } from "./outbox";
import type { Notifier, OutgoingMessage } from "./providers";

let store: FakeNotifyStore;
let now: Date;
let deps: NotifyDeps & { config: AlertConfig };
const meta = { ip: null, userAgent: "vitest" };

beforeEach(() => {
  store = new FakeNotifyStore();
  now = new Date("2026-11-05T09:04:00Z");
  deps = { store, now: () => now, config: { teamEmail: "alertas@margoai.com", founderOnDutyEmail: "marlon@margoai.com" } };
  store.accounts.set("acc", "Grupo A (G-02)");
  store.people.push(
    { id: "marlon", name: "Marlon", email: "marlon@margoai.com", whatsappE164: "+5543999990000", staff: true, memberships: [] },
    { id: "dono", name: "Dono", email: "d@x.com", whatsappE164: null, memberships: [{ accountId: "acc", role: "dono" }] },
  );
});

const outbox = () => store.notifications.map((n) => `${n.channel}:${n.recipient}`);

describe("C21 raise", () => {
  it("C21_urgente_emails_the_team_and_whatsapps_the_founder_on_duty", async () => {
    const { id, created } = await raiseAlert(deps, "urgente", "Importação da API falhou 2 vezes: token expirado", "acc", "/console/conectar");
    expect(created).toBe(true);
    expect(store.alerts[0]).toMatchObject({ id, severity: "urgente", accountId: "acc", notifiedVia: ["team_email", "founder_whatsapp"], openedAt: now });
    expect(outbox()).toEqual(["email:alertas@margoai.com", "whatsapp_manual:+5543999990000"]);
    expect(store.notifications[0]).toMatchObject({
      alertId: id, noticeCode: null, personId: null,
      subject: "Alerta urgente: Importação da API falhou 2 vezes: token expirado",
      body: "Importação da API falhou 2 vezes: token expirado\nCliente: Grupo A (G-02)\nAbrir: /console/conectar\n\nO alerta fica em Alertas até alguém da equipe resolver.",
    });
    expect(store.notifications[1]).toMatchObject({
      personId: "marlon",
      body: "Alerta urgente na MargoAI: Importação da API falhou 2 vezes: token expirado. Cliente: Grupo A (G-02). /console/conectar",
    });
    expect(notifiedViaLabel(store.alerts[0].notifiedVia)).toBe("e-mail e WhatsApp da equipe");
  });

  it.each(["medio", "baixo"] as const)("C21_%s_goes_by_team_email_only", async (severity) => {
    await raiseAlert(deps, severity, "Extensão sem enviar há 3 dias", "acc", null);
    expect(outbox()).toEqual(["email:alertas@margoai.com"]);
    expect(notifiedViaLabel(store.alerts[0].notifiedVia)).toBe("e-mail da equipe");
  });

  it("C21_notified_via_reads_team_and_owner_channels_as_drawn", () => {
    expect(notifiedViaLabel(["email_equipe", "whatsapp_equipe"])).toBe("e-mail e WhatsApp da equipe");
    expect(notifiedViaLabel(["email_equipe", "email_dono"])).toBe("e-mail da equipe e do dono");
    expect(notifiedViaLabel(["email_equipe", "whatsapp_dono"])).toBe("e-mail da equipe; WhatsApp do dono");
    expect(notifiedViaLabel(["email_dono", "whatsapp_dono"])).toBe("e-mail e WhatsApp do dono");
    expect(notifiedViaLabel(["email_equipe"])).toBe("e-mail da equipe");
    expect(notifiedViaLabel([])).toBe("");
  });

  it("C21_urgente_without_a_founder_on_duty_still_emails_the_team", async () => {
    deps.config = { ...deps.config, founderOnDutyEmail: null };
    await raiseAlert(deps, "urgente", "Cobrança recusada no cartão", "acc", null);
    expect(outbox()).toEqual(["email:alertas@margoai.com"]);
    expect(store.alerts[0].notifiedVia).toEqual(["team_email"]);
  });

  it("C21_founder_whatsapp_ignores_quiet_hours", async () => {
    now = new Date("2026-11-05T06:00:00Z"); // 03:00 in São Paulo
    await raiseAlert(deps, "urgente", "Worker sem responder", null, null);
    const notifier: Notifier = { deliver: async (m: OutgoingMessage) => ({ providerId: `id-${m.notificationId}` }) };
    expect(await processOutbox({ ...deps, notifier })).toEqual({ sent: 2, released: 0, held: 0, failed: 0 });
  });

  it("C21_an_open_alert_is_not_raised_twice", async () => {
    const first = await raiseAlert(deps, "medio", "Extensão sem enviar há 3 dias", "acc", null);
    const again = await raiseAlert(deps, "medio", "Extensão sem enviar há 3 dias", "acc", null);
    expect(again).toEqual({ id: first.id, created: false });
    expect(store.alerts).toHaveLength(1);
    expect(store.notifications).toHaveLength(1);
  });

  it("reads team address and founder on duty from the environment", () => {
    expect(alertConfigFromEnv({})).toEqual({ teamEmail: "alertas@margoai.com", founderOnDutyEmail: null });
    expect(alertConfigFromEnv({ MARGO_TEAM_EMAIL: "equipe@x.com", MARGO_FOUNDER_ON_DUTY: "m@x.com" })).toEqual({
      teamEmail: "equipe@x.com", founderOnDutyEmail: "m@x.com",
    });
  });
});

describe("C21 resolve", () => {
  it("C21_staff_resolves_and_it_is_audited", async () => {
    const { id } = await raiseAlert(deps, "baixo", "Loja nova no iFood sem cozinha", "acc", null);
    now = new Date("2026-11-05T12:00:00Z");
    expect(await resolveAlert(deps, id, "marlon", meta)).toEqual({ ok: true });
    expect(store.alerts[0]).toMatchObject({ resolvedAt: now, resolvedBy: "marlon" });
    expect(store.audits).toEqual([
      {
        actorPersonId: "marlon", actorKind: "staff", accountId: "acc", action: "alert.resolve", entity: "alert", entityId: id,
        before: { resolved_at: null, resolved_by: null }, after: { resolved_at: now.toISOString(), resolved_by: "marlon" },
        ip: null, userAgent: "vitest",
      },
    ]);
    // Resolved: the same problem can be raised again.
    expect((await raiseAlert(deps, "baixo", "Loja nova no iFood sem cozinha", "acc", null)).created).toBe(true);
  });

  it("C21_non_staff_cannot_resolve", async () => {
    const { id } = await raiseAlert(deps, "baixo", "Loja nova no iFood sem cozinha", "acc", null);
    expect(await resolveAlert(deps, id, "dono", meta)).toEqual({ ok: false, message: ALERT_MESSAGES.staffOnly });
    expect(store.alerts[0].resolvedAt).toBeNull();
    expect(store.audits).toEqual([]);
  });

  it("refuses an unknown or already resolved alert", async () => {
    const { id } = await raiseAlert(deps, "baixo", "Loja nova no iFood sem cozinha", "acc", null);
    await resolveAlert(deps, id, "marlon", meta);
    expect(await resolveAlert(deps, id, "marlon", meta)).toEqual({ ok: false, message: ALERT_MESSAGES.alreadyResolved });
    expect(await resolveAlert(deps, "nope", "marlon", meta)).toEqual({ ok: false, message: ALERT_MESSAGES.notFound });
    expect(store.audits).toHaveLength(1);
  });
});
