// Public entry of the owner portal (05 §B): sign-up (P07, W06; 04 §7), invite acceptance (P18; 04 §8)
// and the founders' verification request (P17; 04 §8). The writes run in SQL functions, one transaction
// each (supabase/migrations/20261117000010_portal_entry.sql), which also write audit_log (A04).
import { createHash } from "node:crypto";
import type { Db } from "@/lib/supabase/admin";
import { sendCode, type LoginDeps, type SendResult } from "@/lib/auth/login";
import { notify, type NotifyDeps } from "@/lib/notify/outbox";
import { raiseAlert, type AlertConfig } from "@/lib/notify/alerts";
import type { MemberRole } from "@/lib/permissions";
import { cnpjDigits, formatCnpj, validCnpj } from "./cnpj";
import { kitchenShort, maskWhatsapp, parseWhatsapp } from "./format";

// Not drawn; short, same style as P07 and P18.
export const ENTRY_MESSAGES = {
  name: "Escreva seu nome e o nome do restaurante.",
  personName: "Escreva seu nome.",
  cnpj: "Confira o CNPJ: os números não batem.",
  email: "Confira o e-mail.",
  whatsapp: "Confira o WhatsApp, com DDD.",
  terms: "Para continuar, aceite os termos e a política de privacidade.",
  inviteInvalid: "Este convite venceu ou já foi usado. Peça um convite novo para quem te convidou.",
  emailTaken: "Este e-mail já está em uso. Use outro.",
  alreadyMember: "Você já faz parte desta conta. Entre com o seu e-mail.",
  verificationSent: "Pedido enviado. A equipe da MargoAI confere pelo CNPJ e pelo contrato social e fala com você pelo contato informado.",
  contact: "Escreva um e-mail ou WhatsApp para a equipe falar com você.",
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const meta = (m: { ip: string | null; userAgent: string | null }) => ({ p_ip: m.ip as unknown as string, p_user_agent: m.userAgent as unknown as string });
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// P07, W06 ------------------------------------------------------------------------------------------

export interface SignUpInput {
  name: string;
  restaurant: string;
  cnpj: string;
  whatsapp: string;
  email: string;
  terms: boolean;
  /** P07 ?ref=<xray> (P02 link). */
  ref?: string | null;
}

export interface SignUpValue {
  name: string;
  restaurant: string;
  cnpj: string;
  whatsapp: string | null;
  email: string;
  xrayId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateSignUp(i: SignUpInput): { ok: true; value: SignUpValue } | { ok: false; message: string } {
  const name = i.name.trim();
  const restaurant = i.restaurant.trim();
  const email = i.email.trim().toLowerCase();
  if (!name || !restaurant || name.length > 120 || restaurant.length > 120) return { ok: false, message: ENTRY_MESSAGES.name };
  if (!validCnpj(i.cnpj)) return { ok: false, message: ENTRY_MESSAGES.cnpj };
  if (!EMAIL.test(email) || email.length > 200) return { ok: false, message: ENTRY_MESSAGES.email };
  const whatsapp = i.whatsapp.trim() ? parseWhatsapp(i.whatsapp) : null;
  if (i.whatsapp.trim() && !whatsapp) return { ok: false, message: ENTRY_MESSAGES.whatsapp };
  if (!i.terms) return { ok: false, message: ENTRY_MESSAGES.terms };
  return { ok: true, value: { name, restaurant, cnpj: cnpjDigits(i.cnpj), whatsapp, email, xrayId: i.ref && UUID.test(i.ref) ? i.ref : null } };
}

/**
 * P07 "Começar meus N dias grátis": creates the account in trial (04 §7) and sends the login code.
 * An e-mail that already has a person creates nothing and gets the same answer (no enumeration).
 */
export async function signUp(db: Db, login: LoginDeps, input: SignUpInput, m: { ip: string | null; userAgent: string | null }): Promise<SendResult> {
  const v = validateSignUp(input);
  if (!v.ok) return { ok: false, message: v.message };
  const { error } = await db.rpc("portal_sign_up", {
    p_name: v.value.name,
    p_restaurant: v.value.restaurant,
    p_cnpj: v.value.cnpj,
    p_email: v.value.email,
    p_whatsapp: v.value.whatsapp as unknown as string,
    p_xray: v.value.xrayId as unknown as string,
    ...meta(m),
  });
  if (error) throw new Error(error.message);
  return sendCode(login, { email: v.value.email, surface: "portal" });
}

/** P07: "Começar meus 14 dias grátis" reads trial_days of the plan the trial gets (Lucro, 04 §6). */
export async function trialDays(db: Db): Promise<number> {
  const { data } = await db.from("plan").select("trial_days").eq("code", "lucro").maybeSingle();
  return data?.trial_days ?? 14;
}

// P18 -------------------------------------------------------------------------------------------------

/** 04 §5 profile names. */
export const PROFILE_LABEL: Record<MemberRole, string> = { dono: "Dono", financeiro: "Financeiro", gerente: "Gerente de cozinha" };

export interface InviteView {
  inviter: string;
  accountName: string;
  role: MemberRole;
  channel: "email" | "whatsapp";
  /** "Centro", or "todas". */
  kitchens: string;
  /** What this profile sees (P18). */
  sees: string;
  /** "Convite enviado por WhatsApp para (43) 9 ••••-5678." */
  sentTo: string;
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}•••@${domain ?? ""}`;
}

/** "Cozinha Centro", "Cozinha Centro e Cozinha Zona Sul". */
const joinNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);

/** P18 text for one profile. The Gerente line is drawn; the others follow it. */
export function profileSees(role: MemberRole, kitchenNames: string[]): string {
  if (role === "gerente") {
    return kitchenNames.length
      ? `Você vai ver o fechamento, as contestações e as notas da ${joinNames(kitchenNames)}. Não vê cobrança nem outras cozinhas.`
      : "Você ainda não vê nenhuma cozinha. Não vê cobrança.";
  }
  if (role === "financeiro") return "Você vai ver o fechamento, as contestações e as notas de todas as cozinhas. Não vê cobrança nem pessoas.";
  return "Você vai ver tudo da conta, inclusive cobrança e pessoas.";
}

/** P18: the invite behind a link, or null when unknown, used or expired (no account data then). */
export async function inviteView(db: Db, token: string, now = new Date()): Promise<InviteView | null> {
  const { data: inv } = await db
    .from("invite")
    .select("account_id, role, kitchen_ids, channel, destination, expires_at, accepted_at, account(name), person!invite_invited_by_fkey(name)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!inv || inv.accepted_at || new Date(inv.expires_at) <= now) return null;
  const { data: ks } = inv.kitchen_ids.length
    ? await db.from("kitchen").select("name").eq("account_id", inv.account_id).in("id", inv.kitchen_ids).order("name")
    : { data: [] as { name: string }[] };
  const names = (ks ?? []).map((k) => k.name);
  const allKitchens = names.length === 0 && inv.role !== "gerente";
  return {
    inviter: inv.person?.name ?? "Alguém",
    accountName: inv.account?.name ?? "",
    role: inv.role,
    channel: inv.channel,
    kitchens: allKitchens ? "todas" : names.map(kitchenShort).join(", "),
    sees: profileSees(inv.role, names),
    sentTo: inv.channel === "whatsapp" ? `Convite enviado por WhatsApp para ${maskWhatsapp(inv.destination)}.` : `Convite enviado por e-mail para ${maskEmail(inv.destination)}.`,
  };
}

export interface AcceptInput {
  token: string;
  name: string;
  /** Only for a WhatsApp invite: the e-mail the person logs in with (codes go by e-mail until D36). */
  email?: string;
  terms: boolean;
}

export type AcceptResult =
  | { ok: true; personId: string; accountId: string; email: string; channel: "email" | "whatsapp" }
  | { ok: false; message: string };

/** P18 "Aceitar e entrar": membership from the invite (SQL, audited), then security_event to the Donos. */
export async function acceptInvite(
  deps: { db: Db; notify: NotifyDeps },
  i: AcceptInput,
  m: { ip: string | null; userAgent: string | null },
): Promise<AcceptResult> {
  const name = i.name.trim();
  if (!name || name.length > 120) return { ok: false, message: ENTRY_MESSAGES.personName };
  if (!i.terms) return { ok: false, message: ENTRY_MESSAGES.terms };
  const email = i.email?.trim().toLowerCase() ?? "";
  if (email && !EMAIL.test(email)) return { ok: false, message: ENTRY_MESSAGES.email };

  const { data: inv } = await deps.db.from("invite").select("channel, role").eq("token_hash", hashToken(i.token)).maybeSingle();
  if (inv?.channel === "whatsapp" && !email) return { ok: false, message: ENTRY_MESSAGES.email };

  const { data, error } = await deps.db.rpc("portal_accept_invite", { p_token_hash: hashToken(i.token), p_name: name, p_email: email || (null as unknown as string), ...meta(m) });
  if (error) throw new Error(error.message);
  const r = data?.[0];
  if (!r || r.status === "invalid" || !inv) return { ok: false, message: ENTRY_MESSAGES.inviteInvalid };
  if (r.status === "email_taken") return { ok: false, message: ENTRY_MESSAGES.emailTaken };
  if (r.status === "already_member") return { ok: false, message: ENTRY_MESSAGES.alreadyMember };

  // 04 §9 security_event "Pessoa nova": every Dono, e-mail locked on. Not drawn; same style as the login notice.
  await notify(deps.notify, {
    code: "security_event",
    accountId: r.account_id,
    message: { subject: "Pessoa nova na conta", body: `${name} aceitou o convite e entrou como ${PROFILE_LABEL[inv.role]}.` },
  });
  return { ok: true, personId: r.person_id, accountId: r.account_id, email: r.email, channel: inv.channel };
}

// P17 -------------------------------------------------------------------------------------------------

/**
 * P17 "Perdi o acesso ao e-mail e ao WhatsApp": opens an alert for the founders (04 §8, §10), who check the
 * CNPJ against the articles of association and re-invite. The answer never says whether the CNPJ is a client.
 */
export async function requestVerification(
  deps: { db: Db; alerts: NotifyDeps & { config: AlertConfig } },
  i: { cnpj: string; contact: string },
  m: { ip: string | null; userAgent: string | null },
): Promise<SendResult> {
  if (!validCnpj(i.cnpj)) return { ok: false, message: ENTRY_MESSAGES.cnpj };
  const contact = i.contact.trim().replace(/\s+/g, " ").slice(0, 80);
  if (contact.length < 5) return { ok: false, message: ENTRY_MESSAGES.contact };
  const cnpj = cnpjDigits(i.cnpj);
  const { data: company } = await deps.db.from("company").select("account_id").eq("cnpj", cnpj).limit(1).maybeSingle();
  const accountId = company?.account_id ?? null;
  const title = `Verificar acesso do único Dono: CNPJ ${formatCnpj(cnpj)}, contato ${contact}`;
  const alert = await raiseAlert(deps.alerts, "medio", title, accountId, accountId ? "/console" : null);
  const { error } = await deps.db.from("audit_log").insert({
    actor_person_id: null,
    actor_kind: "system",
    account_id: accountId,
    action: "access_recovery.request",
    entity: "alert",
    entity_id: alert.id,
    after: { cnpj, contact, created: alert.created },
    ip: m.ip,
    user_agent: m.userAgent,
  });
  if (error) throw new Error(error.message);
  return { ok: true, message: ENTRY_MESSAGES.verificationSent };
}
