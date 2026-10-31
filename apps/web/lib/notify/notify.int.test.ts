// E05, C21 against the local Supabase stack: preferences, outbox delivery to a temporary dev inbox,
// the locked-notice trigger, and alerts. Run with `pnpm test:int`. Creates and deletes its own synthetic account.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient } from "@/lib/supabase/admin";
import { raiseAlert, resolveAlert } from "./alerts";
import { notify, processOutbox } from "./outbox";
import { PREF_MESSAGES, updateNoticePref } from "./prefs";
import { ChannelNotifier, DevInbox, DevInboxProvider, ManualWhatsAppProvider } from "./providers";
import { SupabaseNotifyStore } from "./supabase-store";

const db = adminClient();
const store = new SupabaseNotifyStore(db);
const tag = randomBytes(4).toString("hex");
const emails = { dono: `int-dono-${tag}@teste.local`, fin: `int-fin-${tag}@teste.local`, staff: `int-staff-${tag}@teste.local` };
const phone = `+55439${String(parseInt(tag, 16) % 1e8).padStart(8, "0")}`;
const staffPhone = `+55119${String((parseInt(tag, 16) + 1) % 1e8).padStart(8, "0")}`;
const meta = { ip: "203.0.113.9", userAgent: "vitest" };
let accountId = "";
const ids = { dono: "", fin: "", staff: "" };
let dir = "";
let inbox: DevInbox;
let now = new Date();
const deps = () => ({ store, now: () => now });
const notifier = () => new ChannelNotifier({ email: new DevInboxProvider(inbox), whatsappManual: new ManualWhatsAppProvider(inbox) });
const inboxLines = () => readFileSync(inbox.file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, string>);
const sp = (iso: string) => new Date(`${iso}-03:00`);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "margo-notify-int-"));
  inbox = new DevInbox(join(dir, "inbox.jsonl"));
  const acc = await db.from("account").insert({ name: "Conta notificações", code: `T-NOT-${tag}`, is_synthetic: true }).select("id").single();
  accountId = acc.data!.id;
  const people = await db
    .from("person")
    .insert([
      { name: "Dono notificações", email: emails.dono, whatsapp_e164: phone },
      { name: "Financeiro notificações", email: emails.fin },
      { name: "Staff notificações", email: emails.staff, whatsapp_e164: staffPhone },
    ])
    .select("id, email");
  const id = (e: string) => people.data!.find((p) => p.email === e)!.id;
  ids.dono = id(emails.dono);
  ids.fin = id(emails.fin);
  ids.staff = id(emails.staff);
  await db.from("membership").insert([
    { account_id: accountId, person_id: ids.dono, role: "dono" },
    { account_id: accountId, person_id: ids.fin, role: "financeiro" },
  ]);
  await db.from("staff").insert({ person_id: ids.staff, role: "fundador" });
});

afterAll(async () => {
  await db.from("notification").delete().in("person_id", [ids.dono, ids.fin, ids.staff]);
  await db.from("alert").delete().like("title", `%${tag}%`);
  await db.from("account").delete().eq("id", accountId);
  await db.from("person").delete().in("id", Object.values(ids));
  rmSync(dir, { recursive: true, force: true });
});

/** Rows of this test's account, oldest first. */
async function rows() {
  const r = await db.from("notification").select("person_id, channel, status, provider_id").eq("account_id", accountId).order("created_at");
  return r.data!.map((n) => `${n.person_id === ids.dono ? "dono" : "fin"}:${n.channel}:${n.status}`);
}

/** Only this test's rows go through the processor; the outbox may hold rows of other tests. */
function scoped(): SupabaseNotifyStore {
  const s = new SupabaseNotifyStore(db);
  s.outbox = async (limit) => (await store.outbox(1000)).filter((r) => r.accountId === accountId || r.personId === ids.staff).slice(0, limit);
  return s;
}

describe("notifier against the local stack", () => {
  it("E05_int_locked_email_refused_in_code_and_by_the_trigger", async () => {
    expect(await updateNoticePref(deps(), { personId: ids.dono, accountId, noticeCode: "billing_result", email: false, meta }))
      .toEqual({ ok: false, message: PREF_MESSAGES.locked });
    const direct = await db.from("notice_pref").insert({ person_id: ids.dono, account_id: accountId, notice_code: "billing_result", email: false, whatsapp: false });
    expect(direct.error?.message).toMatch(/always sent by e-mail/);
  });

  it("E05_int_preferences_respected_and_quiet_hours_hold_whatsapp", async () => {
    // The Financeiro turns close_ready e-mail off; it is saved and audited.
    expect(await updateNoticePref(deps(), { personId: ids.fin, accountId, noticeCode: "close_ready", email: false, meta }))
      .toEqual({ ok: true, pref: { email: false, whatsapp: true } });
    const audit = await db.from("audit_log").select("action, actor_kind, actor_person_id, before, after, ip").eq("account_id", accountId);
    expect(audit.data).toEqual([
      {
        action: "notice_pref.update", actor_kind: "person", actor_person_id: ids.fin, ip: "203.0.113.9",
        before: { notice_code: "close_ready", email: true, whatsapp: true }, after: { notice_code: "close_ready", email: false, whatsapp: true },
      },
    ]);

    // 23:00 São Paulo: the Dono gets e-mail now and WhatsApp held; the Financeiro has no WhatsApp number.
    now = sp("2026-11-05T23:00:00");
    const message = { subject: `Fechamento pronto ${tag}`, body: "Seu fechamento de setembro está pronto" };
    expect(await notify(deps(), { code: "close_ready", accountId, message })).toEqual({ queued: 1, held: 1 });
    expect(await rows()).toEqual(["dono:email:queued", "dono:whatsapp_manual:held_quiet_hours"]);

    const run = { store: scoped(), notifier: notifier(), now: () => now };
    expect(await processOutbox(run)).toEqual({ sent: 1, released: 0, held: 1, failed: 0 });
    now = sp("2026-11-06T08:00:00");
    expect(await processOutbox(run)).toEqual({ sent: 1, released: 1, held: 0, failed: 0 });
    expect(await rows()).toEqual(["dono:email:sent", "dono:whatsapp_manual:sent"]);

    const wa = await db.from("notification").select("provider_id, sent_at").eq("account_id", accountId).eq("channel", "whatsapp_manual").single();
    expect(wa.data!.provider_id).toBe(`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent("Seu fechamento de setembro está pronto")}`);
    const mail = inboxLines().find((l) => l.subject === message.subject)!;
    expect(mail).toMatchObject({ provider: "dev-inbox", to: emails.dono });
    expect(mail.body).toContain("Você recebe este e-mail porque é Dono no Conta notificações.");
  });

  it("E05_int_security_event_row_from_login_is_delivered_by_email", async () => {
    // A row queued without recipient (written outside the planner): the address is read from person.
    await db.from("notification").insert({
      account_id: accountId, person_id: ids.dono, notice_code: "security_event", channel: "email",
      subject: `Login em aparelho novo ${tag}`, body: "Dono notificações entrou na MargoAI por um aparelho novo.",
    });
    now = sp("2026-11-06T03:00:00"); // e-mail ignores quiet hours
    expect(await processOutbox({ store: scoped(), notifier: notifier(), now: () => now })).toMatchObject({ sent: 1, failed: 0 });
    expect(inboxLines().find((l) => l.subject === `Login em aparelho novo ${tag}`)).toMatchObject({ to: emails.dono });
  });

  it("C21_int_urgente_alert_notifies_team_and_founder_then_staff_resolves", async () => {
    now = new Date();
    const title = `Importação da API falhou 2 vezes ${tag}`;
    const config = { teamEmail: "alertas@margoai.com", founderOnDutyEmail: emails.staff };
    const { id, created } = await raiseAlert({ ...deps(), config }, "urgente", title, accountId, "/console/conectar");
    expect(created).toBe(true);
    expect((await raiseAlert({ ...deps(), config }, "urgente", title, accountId, null)).created).toBe(false);

    const alert = await db.from("alert").select("severity, notified_via, resolved_at").eq("id", id).single();
    expect(alert.data).toEqual({ severity: "urgente", notified_via: ["team_email", "founder_whatsapp"], resolved_at: null });
    const sent = await db.from("notification").select("channel, recipient, person_id, notice_code").eq("alert_id", id).order("channel");
    expect(sent.data).toEqual([
      { channel: "email", recipient: "alertas@margoai.com", person_id: null, notice_code: null },
      { channel: "whatsapp_manual", recipient: staffPhone, person_id: ids.staff, notice_code: null },
    ]);

    // Owners cannot resolve; staff can, and it is audited.
    expect((await resolveAlert(deps(), id, ids.dono, meta)).ok).toBe(false);
    expect(await resolveAlert(deps(), id, ids.staff, meta)).toEqual({ ok: true });
    const resolved = await db.from("alert").select("resolved_by").eq("id", id).single();
    expect(resolved.data!.resolved_by).toBe(ids.staff);
    const audit = await db.from("audit_log").select("action, actor_kind").eq("entity_id", id);
    expect(audit.data).toEqual([{ action: "alert.resolve", actor_kind: "staff" }]);

    // The alert's notification rows go out too (deleted with the alert by cascade in afterAll).
    await db.from("notification").delete().eq("alert_id", id);
  });
});
