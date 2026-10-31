// 04 §7, §9, §10, 06 §4, D27, D37: billing jobs, webhook handling and checkout with fakes and a fake clock.
// No Asaas body is invented here: webhook tests use internal events through a test parser (the parser
// itself is tested against sandbox recordings in asaas-parse.test.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { FakeNotifyStore } from "@/lib/notify/fake-store";
import type { BillingEventIn } from "./asaas-parse";
import { CHECKOUT_MESSAGES, requestRede, startCheckout } from "./checkout";
import { FakeAsaasClient } from "./fake-asaas";
import { FakeBillingStore } from "./fake-store";
import { runPilotCharges, runTrialEnd, runUnitsSync } from "./jobs";
import { addMonth, firstDueDate, pilotChargeCents, pilotWindowInMonth, trialDaysLeft, trialReminderDue } from "./rules";
import { ALERT_TITLES, type BillingDeps } from "./service";
import { handleAsaasWebhook, tokenMatches } from "./webhook";

const TOKEN = "dummy-webhook-token-for-tests";
let store: FakeBillingStore;
let notifyStore: FakeNotifyStore;
let asaas: FakeAsaasClient;
let now: Date;
let deps: BillingDeps;

/** São Paulo is UTC-3 all year. */
const sp = (local: string) => new Date(`${local}-03:00`);

beforeEach(() => {
  store = new FakeBillingStore();
  notifyStore = new FakeNotifyStore();
  asaas = new FakeAsaasClient();
  now = sp("2026-11-01T06:00:00");
  deps = { store, asaas, notify: { store: notifyStore, now: () => now, config: { teamEmail: "alertas@margoai.com", founderOnDutyEmail: null } }, now: () => now };
  for (const [id, name] of [["g01", "Pantanos Burguer"], ["g03", "Grupo B"]]) {
    notifyStore.accounts.set(id, name);
    notifyStore.people.push({ id: `dono-${id}`, name: "Dono", email: `dono@${id}.local`, whatsappE164: "+5543900000001", memberships: [{ accountId: id, role: "dono" }] });
  }
  notifyStore.people.push({ id: "fin-g01", name: "Fin", email: "fin@g01.local", whatsappE164: null, memberships: [{ accountId: "g01", role: "financeiro" }] });
});

const notices = (code: string) => notifyStore.notifications.filter((n) => n.noticeCode === code);

describe("rules (04 §7, D37)", () => {
  it("trial days are São Paulo days; reminders 3 days before and on the day", () => {
    const ends = sp("2026-11-08T23:59:59");
    expect(trialDaysLeft(ends, sp("2026-10-30T10:00:00"))).toBe(9);
    expect(trialReminderDue(ends, sp("2026-11-05T00:30:00"))).toBe("d3");
    expect(trialReminderDue(ends, sp("2026-11-08T08:00:00"))).toBe("d0");
    expect(trialReminderDue(ends, sp("2026-11-07T08:00:00"))).toBeNull();
  });

  it("first due date is the trial end while in trial (06 §4), else today", () => {
    expect(firstDueDate(sp("2026-11-08T23:59:59"), "trial", sp("2026-10-30T10:00:00"))).toBe("2026-11-08");
    expect(firstDueDate(sp("2026-11-08T23:59:59"), "free", sp("2026-11-20T10:00:00"))).toBe("2026-11-20");
    expect(firstDueDate(null, "free", sp("2026-11-20T23:30:00"))).toBe("2026-11-20");
  });

  it("monthly cycle clamps to the month end", () => {
    expect(addMonth("2026-01-31")).toBe("2026-02-28");
    expect(addMonth("2026-12-05")).toBe("2027-01-05");
  });

  it("pilot: 60 days from the start, cut by calendar month; pct of credited, half up, capped", () => {
    expect(pilotWindowInMonth("2026-11-10", "2026-11-01")).toEqual({ from: "2026-11-10", to: "2026-12-01" });
    expect(pilotWindowInMonth("2026-11-10", "2026-12-01")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(pilotWindowInMonth("2026-11-10", "2027-01-01")).toEqual({ from: "2027-01-01", to: "2027-01-09" });
    expect(pilotWindowInMonth("2026-11-10", "2027-02-01")).toBeNull();
    expect(pilotChargeCents(23800, 0.2, null)).toBe(4760); // C15 drawing: 20% de R$ 238 = R$ 47,60
    expect(pilotChargeCents(23800, 0.2, 3000)).toBe(3000);
    expect(pilotChargeCents(25, 0.2, null)).toBe(5);
  });
});

describe("E02 trial end", () => {
  it("test_E02_trial_end_returns_to_free_and_pauses_imports", async () => {
    store.addAccount({ id: "g03", status: "trial", trialEndsAt: sp("2026-11-01T23:59:59"), asaasCustomerId: "cus_x" });
    store.sources.push({ accountId: "g03", pausedAt: null, pausedReason: null });

    now = sp("2026-11-01T22:00:00"); // last day, still in trial
    expect((await runTrialEnd(deps)).returnedToFree).toEqual([]);
    expect(store.sub("g03").status).toBe("trial");

    now = sp("2026-11-02T06:00:00"); // the day after: trial is over without a plan
    const out = await runTrialEnd(deps);
    expect(out.returnedToFree).toEqual(["g03"]);
    expect(store.sub("g03")).toMatchObject({ status: "free", planId: "plan-raio_x", asaasSubscriptionId: null, lastEvent: "fim do teste, voltou ao grátis" });
    expect(store.accounts.find((a) => a.id === "g03")!.planId).toBe("plan-raio_x");
    // Channel imports stop, data kept: every source paused, nothing deleted.
    expect(store.sources.filter((s) => s.accountId === "g03").map((s) => [s.pausedReason, s.pausedAt])).toEqual([
      ["trial_ended", now],
      ["trial_ended", now],
    ]);
    expect(store.audits.map((a) => [a.actorKind, a.action])).toEqual([
      ["system", "notice.trial_ending.d0"], // the last day's notice of the first run
      ["system", "subscription.trial_end"],
      ["system", "import_source.pause"],
    ]);

    // A second run the same day changes nothing.
    const audits = store.audits.length;
    expect((await runTrialEnd(deps)).returnedToFree).toEqual([]);
    expect(store.audits.length).toBe(audits);
  });

  it("E02_account_that_chose_lucro_during_trial_is_not_returned_to_free", async () => {
    store.addAccount({ id: "g01", status: "trial", trialEndsAt: sp("2026-11-08T23:59:59"), asaasCustomerId: "cus_x", asaasSubscriptionId: "sub_x" });
    now = sp("2026-11-09T06:00:00");
    expect((await runTrialEnd(deps)).returnedToFree).toEqual([]);
    expect(store.sub("g01").status).toBe("trial");
    expect(store.sources[0].pausedAt).toBeNull();
  });

  it("E02_trial_ending_notice_3_days_before_and_on_the_day_once_each_to_the_dono", async () => {
    store.addAccount({ id: "g01", status: "trial", trialEndsAt: sp("2026-11-08T23:59:59") });
    now = sp("2026-11-05T06:00:00");
    expect((await runTrialEnd(deps)).reminded).toEqual(["g01"]);
    expect((await runTrialEnd(deps)).reminded).toEqual([]); // same day, not again
    // Dono only (04 §9), e-mail locked on; WhatsApp by default preference.
    expect(notices("trial_ending").map((n) => [n.personId, n.channel])).toEqual([
      ["dono-g01", "email"],
      ["dono-g01", "whatsapp_manual"],
    ]);
    expect(notices("trial_ending")[0].subject).toBe("Seu teste grátis acaba em 3 dias");
    expect(store.sub("g01").lastEvent).toBe("aviso de fim enviado");

    now = sp("2026-11-06T06:00:00");
    expect(await runTrialEnd(deps)).toEqual({ returnedToFree: [], reminded: [], alerted: ["g01"] }); // 04 §10 baixo, two days before
    expect((await runTrialEnd(deps)).alerted).toEqual([]); // the open alert is not raised again
    expect(notifyStore.alerts.map((a) => [a.severity, a.title])).toEqual([["baixo", ALERT_TITLES.trialEnding]]);

    now = sp("2026-11-08T06:00:00");
    expect((await runTrialEnd(deps)).reminded).toEqual(["g01"]);
    expect(notices("trial_ending").filter((n) => n.channel === "email").at(-1)!.subject).toBe("Seu teste grátis acaba hoje");
    for (const n of notices("trial_ending")) expect(n.body).not.toMatch(/—/);
  });
});

/** Webhook through a test parser: the raw body is our own JSON of an internal event. */
const testParse = (raw: unknown) => raw as BillingEventIn;
const event = (over: Partial<BillingEventIn>): BillingEventIn => ({
  eventId: "evt_1",
  asaasEvent: "TEST",
  kind: "payment_confirmed",
  customerId: "cus_g01",
  subscriptionId: "sub_g01",
  paymentId: "pay_1",
  valueCents: 30000,
  dueDate: "2026-11-08",
  externalReference: null,
  ...over,
});
const deliver = (ev: BillingEventIn, token: string | null = TOKEN) => handleAsaasWebhook(deps, { token, rawBody: JSON.stringify(ev) }, TOKEN, testParse);

describe("E01 webhook (06 §4)", () => {
  beforeEach(() => {
    store.addAccount({ id: "g01", status: "trial", trialEndsAt: sp("2026-11-08T23:59:59"), asaasCustomerId: "cus_g01", units: 1 });
  });

  it("E01_webhook_refuses_missing_or_wrong_token_and_a_missing_env", async () => {
    expect(await deliver(event({}), null)).toEqual({ status: 401, outcome: "unauthorized" });
    expect(await deliver(event({}), "dummy-wrong-token")).toEqual({ status: 401, outcome: "unauthorized" });
    expect(await handleAsaasWebhook(deps, { token: TOKEN, rawBody: "{}" }, undefined, testParse)).toEqual({ status: 401, outcome: "unauthorized" });
    expect(tokenMatches("a", "ab")).toBe(false);
    expect(store.events).toEqual([]);
    expect(await handleAsaasWebhook(deps, { token: TOKEN, rawBody: "not json" }, TOKEN, testParse)).toEqual({ status: 400, outcome: "bad_request" });
  });

  it("E01_subscription_created_during_trial_keeps_trial_and_records_the_asaas_id", async () => {
    expect(await deliver(event({ eventId: "evt_sc", kind: "subscription_created", paymentId: null }))).toEqual({ status: 200, outcome: "applied" });
    expect(store.sub("g01")).toMatchObject({ status: "trial", asaasSubscriptionId: "sub_g01", nextDueOn: "2026-11-08", lastEvent: "assinatura criada" });
  });

  it("E01_payment_confirmed_sets_active_and_a_replay_changes_nothing", async () => {
    store.sources.push({ accountId: "g01", pausedAt: now, pausedReason: "trial_ended" });
    const first = await deliver(event({}));
    expect(first).toEqual({ status: 200, outcome: "applied" });
    expect(store.sub("g01")).toMatchObject({ status: "active", planId: "plan-lucro", asaasSubscriptionId: "sub_g01", nextDueOn: "2026-12-08", lastEvent: "pagamento confirmado" });
    expect(store.invoices).toEqual([
      { accountId: "g01", asaasPaymentId: "pay_1", asaasSubscriptionId: "sub_g01", dueOn: "2026-11-08", units: 1, amountCents: 30000, status: "confirmed" },
    ]);
    expect(store.sources.every((s) => s.pausedAt === null)).toBe(true);
    expect(notices("billing_result").map((n) => [n.personId, n.channel, n.subject])).toEqual([["dono-g01", "email", "Cobrança aprovada"]]);
    expect(notices("billing_result")[0].body).toContain("R$ 300,00");

    const snapshot = JSON.stringify({ sub: store.sub("g01"), inv: store.invoices, audits: store.audits, n: notifyStore.notifications.length });
    // Asaas delivers the same event again: stored once, nothing changes (C15 "Done when").
    expect(await deliver(event({}))).toEqual({ status: 200, outcome: "duplicate" });
    now = new Date(now.getTime() + 60_000);
    expect(await deliver(event({}))).toEqual({ status: 200, outcome: "duplicate" });
    expect(JSON.stringify({ sub: store.sub("g01"), inv: store.invoices, audits: store.audits, n: notifyStore.notifications.length })).toBe(snapshot);
    expect(store.events).toHaveLength(1);
  });

  it("E01_refused_card_makes_an_active_subscription_past_due_with_notice_and_urgent_alert", async () => {
    store.sub("g01").status = "active";
    store.sub("g01").asaasSubscriptionId = "sub_g01";
    expect(await deliver(event({ eventId: "evt_r", kind: "payment_refused" }))).toMatchObject({ outcome: "applied" });
    expect(store.sub("g01")).toMatchObject({ status: "past_due", lastEvent: "cobrança recusada" });
    expect(store.invoices[0].status).toBe("refused");
    expect(notices("billing_result")[0].subject).toBe("Cobrança recusada");
    expect(notifyStore.alerts.map((a) => [a.severity, a.title, a.link])).toEqual([["urgente", "Cobrança recusada no cartão", "/console/assinaturas"]]);
  });

  it("E01_overdue_sets_past_due", async () => {
    store.sub("g01").status = "active";
    store.sub("g01").asaasSubscriptionId = "sub_g01";
    await deliver(event({ eventId: "evt_o", kind: "payment_overdue" }));
    expect(store.sub("g01")).toMatchObject({ status: "past_due", lastEvent: "pagamento atrasado" });
    expect(store.invoices[0].status).toBe("overdue");
  });

  it("E01_subscription_deleted_returns_to_raio_x_canceled_and_pauses_imports", async () => {
    store.sub("g01").status = "active";
    store.sub("g01").asaasSubscriptionId = "sub_g01";
    await deliver(event({ eventId: "evt_d", kind: "subscription_deleted", paymentId: null }));
    expect(store.sub("g01")).toMatchObject({ status: "canceled", planId: "plan-raio_x", asaasSubscriptionId: null, lastEvent: "assinatura cancelada" });
    expect(store.sources[0].pausedReason).toBe("subscription_canceled");
  });

  it("E01_unknown_and_unmatched_events_are_stored_and_ignored", async () => {
    expect(await deliver(event({ eventId: "evt_u", kind: "unknown" }))).toEqual({ status: 200, outcome: "ignored" });
    expect(await deliver(event({ eventId: "evt_n", customerId: "cus_other", subscriptionId: "sub_other" }))).toEqual({ status: 200, outcome: "unmatched" });
    expect(store.events.map((e) => [e.eventId, e.accountId, e.processedAt])).toEqual([
      ["evt_u", "g01", null],
      ["evt_n", null, null],
    ]);
    expect(store.sub("g01").status).toBe("trial");
  });

  it("E01_a_failure_releases_the_event_so_the_retry_applies_it", async () => {
    store.planRows = store.planRows.filter((p) => p.code !== "lucro"); // applying fails
    expect(await deliver(event({}))).toEqual({ status: 500, outcome: "error" });
    expect(store.events[0].processedAt).toBeNull();
    store.planRows = (await new FakeBillingStore().plans());
    expect(await deliver(event({}))).toEqual({ status: 200, outcome: "applied" });
    expect(store.sub("g01").status).toBe("active");
  });
});

describe("P09/W05 checkout (06 §4)", () => {
  const actor = { personId: "dono-g01", ip: "127.0.0.1", userAgent: "vitest" };
  beforeEach(() => {
    now = sp("2026-10-30T10:00:00");
    store.addAccount({ id: "g01", status: "trial", trialEndsAt: sp("2026-11-08T23:59:59"), units: 2, unitsBilled: 1 });
  });

  it("P09_checkout_during_trial_is_recurrent_card_with_first_due_on_trial_end_and_price_times_units", async () => {
    const r = await startCheckout(deps, actor, "g01", "http://localhost:3107");
    expect(r).toEqual({ ok: true, url: asaas.checkouts[0].url });
    expect(asaas.customers).toEqual([
      { name: "Empresa g01 Ltda", cpfCnpj: "11222333000100", email: "dono@g01.local", externalReference: "g01", id: asaas.customers[0].id },
    ]);
    expect(asaas.checkouts[0]).toMatchObject({
      customerId: asaas.customers[0].id,
      valueCents: 60000,
      nextDueDate: "2026-11-08",
      successUrl: "http://localhost:3107/app/plano?status=sucesso",
      cancelUrl: "http://localhost:3107/app/plano?status=cancelado",
      externalReference: "g01",
    });
    // The status does not move until the webhook (D27).
    expect(store.sub("g01")).toMatchObject({ status: "trial", asaasCustomerId: asaas.customers[0].id, unitsBilled: 2 });
    expect(store.audits.map((a) => [a.actorKind, a.actorPersonId, a.action])).toEqual([
      ["person", "dono-g01", "subscription.asaas_customer"],
      ["person", "dono-g01", "subscription.checkout_start"],
    ]);
    // A second checkout reuses the customer.
    await startCheckout(deps, actor, "g01", "http://localhost:3107");
    expect(asaas.customers).toHaveLength(1);
  });

  it("P09_checkout_after_trial_charges_from_today", async () => {
    store.sub("g01").status = "free";
    now = sp("2026-11-20T10:00:00");
    await startCheckout(deps, actor, "g01", "https://app.margoai.com");
    expect(asaas.checkouts[0].nextDueDate).toBe("2026-11-20");
  });

  it("P09_checkout_refused_under_security_lock_without_units_or_when_already_lucro", async () => {
    store.locks.push({ accountId: "g01", until: new Date(now.getTime() + 3600_000) });
    expect(await startCheckout(deps, actor, "g01", "http://x")).toEqual({ ok: false, message: CHECKOUT_MESSAGES.locked });
    store.locks = [];
    store.units.set("g01", { kitchen: 0, channel_store: 0 });
    expect(await startCheckout(deps, actor, "g01", "http://x")).toEqual({ ok: false, message: "Escolha ao menos uma cozinha para a análise antes de assinar." });
    store.units.set("g01", { kitchen: 1, channel_store: 1 });
    store.sub("g01").asaasSubscriptionId = "sub_g01";
    expect(await startCheckout(deps, actor, "g01", "http://x")).toEqual({ ok: false, message: CHECKOUT_MESSAGES.alreadyLucro });
    expect(asaas.checkouts).toEqual([]);
  });

  it("P09_asaas_failure_shows_a_message_and_writes_nothing", async () => {
    asaas.failNext.createCheckout = true;
    store.sub("g01").asaasCustomerId = "cus_g01";
    expect(await startCheckout(deps, actor, "g01", "http://x")).toEqual({ ok: false, message: CHECKOUT_MESSAGES.unavailable });
    expect(store.audits).toEqual([]);
  });

  it("W05_falar_com_a_gente_raises_one_alert_and_audits_each_click", async () => {
    await requestRede(deps, actor, "g01");
    await requestRede(deps, actor, "g01");
    expect(notifyStore.alerts.map((a) => [a.severity, a.title])).toEqual([["medio", "Pediu o plano Rede"]]);
    expect(store.audits.map((a) => a.action)).toEqual(["subscription.request_rede", "subscription.request_rede"]);
  });
});

describe("units (04 §7, 06 §4)", () => {
  it("units_change_updates_the_asaas_value_for_the_next_cycle", async () => {
    store.addAccount({ id: "g02", status: "active", asaasSubscriptionId: "sub_g02", units: 3, unitsBilled: 2 });
    store.addAccount({ id: "g01", status: "trial", units: 1, unitsBilled: 1 });
    store.addAccount({ id: "syn", status: "active", asaasSubscriptionId: "sub_syn", units: 4, unitsBilled: 2, synthetic: true });
    const out = await runUnitsSync(deps);
    expect(out).toEqual({ changed: ["g02", "syn"], asaasUpdated: ["g02"] });
    expect(asaas.valueUpdates).toEqual([{ subscriptionId: "sub_g02", valueCents: 90000 }]);
    expect(store.sub("g02").unitsBilled).toBe(3);
    expect(store.audits.map((a) => [a.actorKind, a.action, a.accountId])).toEqual([
      ["system", "subscription.units", "g02"],
      ["system", "subscription.units", "syn"],
    ]);
    expect((await runUnitsSync(deps)).changed).toEqual([]);
  });
});

describe("pilot charges (D37)", () => {
  beforeEach(() => {
    store.addAccount({ id: "g03", status: "trial", asaasCustomerId: "cus_g03" });
    store.pilotRows.push({ id: "pilot-g03", accountId: "g03", pct: 0.2, capCents: 10000, fixedFromDay61Cents: 30000, startedOn: "2026-10-10" });
    store.credited.set("g03", [
      { amountCents: 23800, creditedOn: "2026-10-20" },
      { amountCents: 1000, creditedOn: "2026-10-05" }, // before the pilot
      { amountCents: 80000, creditedOn: "2026-11-15" },
      { amountCents: 50000, creditedOn: "2026-12-12" }, // after day 60
    ]);
  });

  it("pilot_month_charge_is_pct_of_credited_once_capped_and_never_twice", async () => {
    now = sp("2026-11-01T06:00:00");
    expect((await runPilotCharges(deps)).charged).toEqual(["g03"]);
    expect(store.charges).toEqual([
      expect.objectContaining({ month: "2026-10-01", creditedCents: 23800, chargeCents: 4760, status: "charged", asaasPaymentId: asaas.payments[0].id }),
    ]);
    expect(asaas.payments[0]).toMatchObject({ customerId: "cus_g03", valueCents: 4760, externalReference: `pilot_charge:${store.charges[0].id}` });
    expect((await runPilotCharges(deps)).charged).toEqual([]); // same month again
    expect(asaas.payments).toHaveLength(1);

    now = sp("2026-12-02T06:00:00");
    await runPilotCharges(deps);
    expect(store.charges[1]).toMatchObject({ month: "2026-11-01", creditedCents: 80000, chargeCents: 10000 }); // capped

    now = sp("2027-01-02T06:00:00");
    await runPilotCharges(deps);
    expect(store.charges[2]).toMatchObject({ month: "2026-12-01", creditedCents: 0, chargeCents: 0, status: "no_charge" }); // 12/dez is after day 60
    now = sp("2027-02-02T06:00:00");
    await runPilotCharges(deps);
    expect(store.charges).toHaveLength(3); // from day 61, the fixed subscription
  });

  it("pilot_with_open_values_or_synthetic_account_is_not_charged", async () => {
    store.pilotRows[0].capCents = null;
    now = sp("2026-11-01T06:00:00");
    expect((await runPilotCharges(deps)).skippedOpenValues).toEqual(["g03"]);
    store.pilotRows[0].capCents = 10000;
    store.accounts[0].isSynthetic = true;
    await runPilotCharges(deps);
    expect(store.charges).toEqual([]);
  });

  it("pilot_failed_asaas_call_stays_pending_raises_an_alert_and_is_not_resent", async () => {
    asaas.failNext.createPayment = true;
    now = sp("2026-11-01T06:00:00");
    expect((await runPilotCharges(deps)).failed).toEqual(["g03"]);
    expect(store.charges[0].status).toBe("pending");
    expect(notifyStore.alerts.map((a) => a.title)).toEqual([ALERT_TITLES.pilotNotSent]);
    await runPilotCharges(deps);
    expect(asaas.payments).toEqual([]);
  });

  it("pilot_payment_webhook_updates_the_charge_not_the_subscription", async () => {
    now = sp("2026-11-01T06:00:00");
    await runPilotCharges(deps);
    const charge = store.charges[0];
    const r = await deliver(event({ eventId: "evt_p", customerId: "cus_g03", subscriptionId: null, paymentId: asaas.payments[0].id, valueCents: 4760, externalReference: `pilot_charge:${charge.id}` }));
    expect(r.outcome).toBe("applied");
    expect(store.charges[0].status).toBe("paid");
    expect(store.sub("g03").status).toBe("trial");
    expect(store.invoices).toEqual([]);
  });
});
