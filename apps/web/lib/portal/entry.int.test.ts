// P07 sign-up, P18 invite and P17 verification against the local Supabase stack (pnpm test:int).
// Creates its own rows and deletes them; audit_log rows stay (append-only, A04).
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MESSAGES, type LoginDeps } from "@/lib/auth/login";
import { SupabaseAuthGateway } from "@/lib/auth/supabase-gateway";
import { SupabaseLoginStore } from "@/lib/auth/supabase-store";
import { publicEnv } from "@/lib/env";
import { updateNoticePref } from "@/lib/notify/prefs";
import { SupabaseNotifyStore } from "@/lib/notify/supabase-store";
import { adminClient } from "@/lib/supabase/admin";
import { cnpjCheckDigits } from "./cnpj";
import { acceptInvite, ENTRY_MESSAGES, hashToken, inviteView, requestVerification, signUp } from "./entry";
import { openInviteSession } from "./invite-session";

const db = adminClient();
const tag = randomBytes(4).toString("hex");
const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const anon = () => createClient(publicEnv().supabaseUrl, publicEnv().supabaseAnonKey, { auth: { persistSession: false } });
const login = (): LoginDeps => ({ store: new SupabaseLoginStore(db), gateway: new SupabaseAuthGateway(anon()), now: () => new Date() });
const notifyDeps = () => ({ store: new SupabaseNotifyStore(db), now: () => new Date() });
const cnpj = (seed: string) => {
  const base = `${seed}0001`.padStart(12, "7").slice(-12);
  return base + cnpjCheckDigits(base);
};

const accounts: string[] = [];
const emails: string[] = [];
const alerts: string[] = [];
let hostAccount = "";
let hostDono = "";
let kitchenA = "";
let kitchenB = "";

async function invite(role: "financeiro" | "gerente", channel: "email" | "whatsapp", destination: string, kitchenIds: string[] = [], expires = "2099-01-01") {
  const token = `tok-${randomBytes(8).toString("hex")}`;
  const { error } = await db.from("invite").insert({
    account_id: hostAccount,
    role,
    kitchen_ids: kitchenIds,
    channel,
    destination,
    token_hash: hashToken(token),
    expires_at: expires,
    invited_by: hostDono,
  });
  if (error) throw error;
  return token;
}

beforeAll(async () => {
  const acc = await db.from("account").insert({ name: `Host ${tag}`, code: `T-PE-${tag}`, is_synthetic: true }).select("id").single();
  hostAccount = acc.data!.id;
  accounts.push(hostAccount);
  const company = await db.from("company").insert({ account_id: hostAccount, cnpj: cnpj("31"), legal_name: "Host" }).select("id").single();
  const ks = await db
    .from("kitchen")
    .insert([
      { account_id: hostAccount, company_id: company.data!.id, name: "Cozinha A" },
      { account_id: hostAccount, company_id: company.data!.id, name: "Cozinha B" },
    ])
    .select("id, name");
  kitchenA = ks.data!.find((k) => k.name === "Cozinha A")!.id;
  kitchenB = ks.data!.find((k) => k.name === "Cozinha B")!.id;
  const donoEmail = `int-pe-dono-${tag}@teste.local`;
  emails.push(donoEmail);
  const p = await db.from("person").insert({ name: "Dono host", email: donoEmail }).select("id").single();
  hostDono = p.data!.id;
  await db.from("membership").insert({ account_id: hostAccount, person_id: hostDono, role: "dono" });
});

afterAll(async () => {
  for (const id of alerts) await db.from("alert").delete().eq("id", id);
  if (accounts.length) await db.from("account").delete().in("id", accounts);
  for (const email of emails) {
    const { data } = await db.from("person").select("id, auth_user_id").ilike("email", email).maybeSingle();
    if (data) await db.from("person").delete().eq("id", data.id);
    if (data?.auth_user_id) await db.auth.admin.deleteUser(data.auth_user_id);
    await db.from("auth_code_guard").delete().eq("email", email);
  }
});

describe("P07 sign-up (04 §7)", () => {
  it("P07_sign_up_creates_account_dono_and_trial_with_audit_and_sends_the_code", async () => {
    const email = `int-pe-signup-${tag}@teste.local`;
    emails.push(email);
    const before = Date.now();
    const r = await signUp(db, login(), { name: "Ana", restaurant: `Restaurante ${tag}`, cnpj: cnpj("42"), whatsapp: "", email, terms: true }, meta);
    expect(r).toEqual({ ok: true, message: MESSAGES.sent });

    const { data: person } = await db.from("person").select("id, name, membership(role, all_kitchens, account_id)").eq("email", email).single();
    expect(person!.membership).toHaveLength(1);
    expect(person!.membership[0]).toMatchObject({ role: "dono", all_kitchens: true });
    const accountId = person!.membership[0].account_id;
    accounts.push(accountId);

    const { data: acc } = await db.from("account").select("code, is_synthetic, trial_ends_at, plan(code, trial_days), company(cnpj), kitchen(in_analysis)").eq("id", accountId).single();
    expect(acc!.code).toMatch(/^G-\d{2,}$/);
    expect(acc!.is_synthetic).toBe(false);
    expect(acc!.plan?.code).toBe("lucro");
    expect(acc!.company[0].cnpj).toBe(cnpj("42"));
    expect(acc!.kitchen).toEqual([{ in_analysis: true }]);
    const trialMs = new Date(acc!.trial_ends_at!).getTime() - before;
    expect(Math.round(trialMs / 86_400_000)).toBe(acc!.plan!.trial_days);

    const { data: sub } = await db.from("subscription").select("status").eq("account_id", accountId).single();
    expect(sub!.status).toBe("trial");
    const { data: audit } = await db.from("audit_log").select("action, actor_person_id").eq("account_id", accountId);
    expect(audit!.map((a) => a.action).sort()).toEqual(["account.sign_up", "membership.create", "subscription.trial"]);
    expect(audit!.every((a) => a.actor_person_id === person!.id)).toBe(true);
  });

  it("P07_existing_email_creates_nothing_and_gets_the_same_answer", async () => {
    const { count: before } = await db.from("account").select("id", { count: "exact", head: true });
    const email = emails[0];
    await db.from("auth_code_guard").delete().eq("email", email);
    const r = await signUp(db, login(), { name: "Outro", restaurant: "Outro", cnpj: cnpj("43"), whatsapp: "", email, terms: true }, meta);
    expect(r).toEqual({ ok: true, message: MESSAGES.sent });
    const { count: after } = await db.from("account").select("id", { count: "exact", head: true });
    expect(after).toBe(before);
  });

  it("P07_invalid_cnpj_or_missing_terms_are_refused_before_any_write", async () => {
    const base = { name: "Ana", restaurant: "R", whatsapp: "", email: `int-pe-x-${tag}@teste.local` };
    const bad = cnpj("44").slice(0, 13) + String((Number(cnpj("44")[13]) + 1) % 10);
    expect(await signUp(db, login(), { ...base, cnpj: bad, terms: true }, meta)).toEqual({ ok: false, message: ENTRY_MESSAGES.cnpj });
    expect(await signUp(db, login(), { ...base, cnpj: cnpj("44"), terms: false }, meta)).toEqual({ ok: false, message: ENTRY_MESSAGES.terms });
    const { data } = await db.from("person").select("id").eq("email", base.email);
    expect(data).toEqual([]);
  });

  it("P07_ref_links_the_xray_public_store_to_the_new_kitchen", async () => {
    const store = await db.from("public_store").insert({ channel: "ifood", external_id: `ext-${tag}`, name: `Loja ${tag}`, url: `https://exemplo.local/${tag}` }).select("id").single();
    const xray = await db.from("xray").insert({ target_store_id: store.data!.id }).select("id").single();
    const email = `int-pe-ref-${tag}@teste.local`;
    emails.push(email);
    await signUp(db, login(), { name: "Ref", restaurant: `Ref ${tag}`, cnpj: cnpj("45"), whatsapp: "(43) 9 1234-0000", email, terms: true, ref: xray.data!.id }, meta);
    const { data: x } = await db.from("xray").select("account_id").eq("id", xray.data!.id).single();
    expect(x!.account_id).not.toBeNull();
    accounts.push(x!.account_id!);
    const { data: cs } = await db.from("channel_store").select("external_id, kitchen_id, source, public_url").eq("account_id", x!.account_id!);
    expect(cs).toHaveLength(1);
    expect(cs![0]).toMatchObject({ external_id: `ext-${tag}`, source: "public", public_url: `https://exemplo.local/${tag}` });
    expect(cs![0].kitchen_id).not.toBeNull();
    await db.from("account").delete().eq("id", x!.account_id!);
    await db.from("xray").delete().eq("id", xray.data!.id);
    await db.from("public_store").delete().eq("id", store.data!.id);
  });
});

describe("P18 invite (04 §8)", () => {
  it("P18_view_shows_inviter_role_kitchens_and_nothing_for_a_bad_token", async () => {
    const token = await invite("gerente", "whatsapp", "+5543900009999", [kitchenA]);
    const v = await inviteView(db, token);
    expect(v).toMatchObject({ inviter: "Dono host", role: "gerente", kitchens: "A", channel: "whatsapp", sentTo: "Convite enviado por WhatsApp para (43) 9 ••••-9999." });
    expect(v!.sees).toBe("Você vai ver o fechamento, as contestações e as notas da Cozinha A. Não vê cobrança nem outras cozinhas.");
    expect(await inviteView(db, "nao-existe")).toBeNull();
    expect(await inviteView(db, await invite("financeiro", "email", `x-${tag}@teste.local`, [], "2020-01-01"))).toBeNull();
  });

  it("P18_accept_email_invite_creates_membership_audits_notifies_and_opens_the_session_once", async () => {
    const email = `int-pe-conv-${tag}@teste.local`;
    emails.push(email);
    const token = await invite("financeiro", "email", email);
    const r = await acceptInvite({ db, notify: notifyDeps() }, { token, name: "Contadora", terms: true }, meta);
    expect(r).toMatchObject({ ok: true, accountId: hostAccount, email, channel: "email" });
    if (!r.ok) return;

    const { data: m } = await db.from("membership").select("role, all_kitchens").eq("account_id", hostAccount).eq("person_id", r.personId).single();
    expect(m).toEqual({ role: "financeiro", all_kitchens: true });
    const { data: audit } = await db.from("audit_log").select("action").eq("account_id", hostAccount).eq("actor_person_id", r.personId);
    expect(audit!.map((a) => a.action).sort()).toEqual(["invite.accept", "membership.create"]);
    // 04 §9 security_event "Pessoa nova" to the Dono, by e-mail (locked on).
    const { data: n } = await db.from("notification").select("channel, subject").eq("account_id", hostAccount).eq("person_id", hostDono).eq("notice_code", "security_event");
    expect(n).toContainEqual({ channel: "email", subject: "Pessoa nova na conta" });

    const sessionId = await openInviteSession(db, anon(), new SupabaseLoginStore(db), email, { userAgent: "vitest", ipCity: null, deviceKey: `dev-${tag}` });
    expect(sessionId).not.toBeNull();
    const { data: sd } = await db.from("session_device").select("surface, person_id").eq("id", sessionId!).single();
    expect(sd).toEqual({ surface: "portal", person_id: r.personId });

    // Single use.
    expect(await acceptInvite({ db, notify: notifyDeps() }, { token, name: "De novo", terms: true }, meta)).toEqual({ ok: false, message: ENTRY_MESSAGES.inviteInvalid });
  });

  it("P18_gerente_invite_gives_only_the_invited_kitchen_and_whatsapp_needs_an_email", async () => {
    const email = `int-pe-ger-${tag}@teste.local`;
    emails.push(email);
    const token = await invite("gerente", "whatsapp", "+5543900008888", [kitchenB]);
    expect(await acceptInvite({ db, notify: notifyDeps() }, { token, name: "Gerente", terms: true }, meta)).toEqual({ ok: false, message: ENTRY_MESSAGES.email });
    const r = await acceptInvite({ db, notify: notifyDeps() }, { token, name: "Gerente", email, terms: true }, meta);
    expect(r).toMatchObject({ ok: true, email, channel: "whatsapp" });
    if (!r.ok) return;
    const { data: m } = await db.from("membership").select("role, all_kitchens, membership_kitchen(kitchen_id)").eq("account_id", hostAccount).eq("person_id", r.personId).single();
    expect(m).toEqual({ role: "gerente", all_kitchens: false, membership_kitchen: [{ kitchen_id: kitchenB }] });
    const { data: p } = await db.from("person").select("whatsapp_e164, email").eq("id", r.personId).single();
    expect(p).toEqual({ whatsapp_e164: "+5543900008888", email });
  });

  it("P18_expired_invite_is_refused_with_the_clear_message", async () => {
    const token = await invite("financeiro", "email", `int-pe-exp-${tag}@teste.local`, [], "2020-01-01");
    expect(await acceptInvite({ db, notify: notifyDeps() }, { token, name: "X", terms: true }, meta)).toEqual({ ok: false, message: ENTRY_MESSAGES.inviteInvalid });
  });
});

describe("E05 and P17", () => {
  it("E05_W08_locked_notice_cannot_be_turned_off_through_the_api_or_the_database", async () => {
    const r = await updateNoticePref(notifyDeps(), { personId: hostDono, accountId: hostAccount, noticeCode: "security_event", email: false, meta });
    expect(r.ok).toBe(false);
    const direct = await db.from("notice_pref").insert({ person_id: hostDono, account_id: hostAccount, notice_code: "billing_result", email: false, whatsapp: false });
    expect(direct.error).not.toBeNull();
    const ok = await updateNoticePref(notifyDeps(), { personId: hostDono, accountId: hostAccount, noticeCode: "weekly_summary", email: false, meta });
    expect(ok).toEqual({ ok: true, pref: { email: false, whatsapp: false } });
  });

  it("P17_verification_request_opens_a_founders_alert_with_the_same_answer_for_any_cnpj", async () => {
    const known = await requestVerification({ db, alerts: { ...notifyDeps(), config: { teamEmail: "alertas@teste.local", founderOnDutyEmail: null } } }, { cnpj: cnpj("31"), contact: `novo-${tag}@teste.local` }, meta);
    const unknown = await requestVerification({ db, alerts: { ...notifyDeps(), config: { teamEmail: "alertas@teste.local", founderOnDutyEmail: null } } }, { cnpj: cnpj("99"), contact: `outro-${tag}@teste.local` }, meta);
    expect(known).toEqual(unknown);
    expect(known).toEqual({ ok: true, message: ENTRY_MESSAGES.verificationSent });
    const { data } = await db.from("alert").select("id, severity, account_id").ilike("title", `%${tag}%`);
    for (const a of data ?? []) alerts.push(a.id);
    expect(data!.map((a) => a.severity)).toEqual(["medio", "medio"]);
    expect(data!.map((a) => a.account_id)).toContain(hostAccount);
  });
});
