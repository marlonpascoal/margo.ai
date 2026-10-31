"use server";
// P14/W04 writes (04 §5 "Convidar e remover pessoas", D33): Dono only, flag conta.pessoas, re-checked here.
// Each goes through a SQL function that checks the Dono again, refuses during a security_lock (E04, D35),
// keeps the last Dono (E04) and writes audit_log in the same transaction (A04).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestMeta } from "@/lib/console/request";
import { notifyDeps } from "@/lib/notify/deps";
import { notify } from "@/lib/notify/outbox";
import type { MemberRole } from "@/lib/permissions";
import { appOrigin, requirePortal, type Member } from "@/lib/portal/session";
import { newInviteToken } from "@/lib/portal/pessoas";
import { inviteText, mailtoLink, normalizeEmail, normalizeWhatsapp, peopleError, PROFILE_LABEL, whatsappShareLink } from "@/lib/portal/scope";
import { adminClient } from "@/lib/supabase/admin";

const PATH = "/app/pessoas";
const ROLES: MemberRole[] = ["dono", "financeiro", "gerente"];
const isRole = (v: unknown): v is MemberRole => ROLES.includes(v as MemberRole);

const gate = () => requirePortal({ action: "people", flags: ["conta.pessoas"] });
const back = (aviso?: string) => redirect(aviso ? `${PATH}?aviso=${encodeURIComponent(aviso)}` : PATH);

async function rpcMeta() {
  const meta = await requestMeta();
  return { p_ip: meta.ip ?? undefined, p_user_agent: meta.userAgent ?? undefined };
}

async function membershipOf(m: Member, id: string) {
  const { data } = await adminClient().from("membership").select("id, role, all_kitchens, membership_kitchen(kitchen_id)").eq("id", id).eq("account_id", m.account.id).maybeSingle();
  return data;
}

/** W04 "Perfil de ..." select. The kitchen scope stays as it is. */
export async function changeRoleAction(form: FormData): Promise<void> {
  const m = await gate();
  const role = form.get("perfil");
  const target = await membershipOf(m, String(form.get("pessoa") ?? ""));
  if (!target || !isRole(role) || role === target.role) back();
  const { error } = await adminClient().rpc("membership_update", {
    p_actor: m.personId,
    p_membership: target!.id,
    p_role: role as MemberRole,
    p_all_kitchens: target!.all_kitchens,
    p_kitchens: (target!.membership_kitchen ?? []).map((k) => k.kitchen_id),
    ...(await rpcMeta()),
  });
  revalidatePath(PATH);
  back(error ? peopleError(error.message) : undefined);
}

/** W04 "Cozinhas": all kitchens or the chosen ones (03 membership.all_kitchens, membership_kitchen). */
export async function changeKitchensAction(form: FormData): Promise<void> {
  const m = await gate();
  const target = await membershipOf(m, String(form.get("pessoa") ?? ""));
  if (!target) back();
  const all = form.get("todas") === "on";
  const { error } = await adminClient().rpc("membership_update", {
    p_actor: m.personId,
    p_membership: target!.id,
    p_role: target!.role,
    p_all_kitchens: all,
    p_kitchens: all ? [] : form.getAll("cozinha").map(String),
    ...(await rpcMeta()),
  });
  revalidatePath(PATH);
  back(error ? peopleError(error.message) : undefined);
}

/** W04 "Remover". */
export async function removePersonAction(form: FormData): Promise<void> {
  const m = await gate();
  const target = await membershipOf(m, String(form.get("pessoa") ?? ""));
  if (!target) back();
  const { error } = await adminClient().rpc("membership_remove", { p_actor: m.personId, p_membership: target!.id, ...(await rpcMeta()) });
  revalidatePath(PATH);
  back(error ? peopleError(error.message) : undefined);
}

export type InviteState = { error?: string; link?: string; share?: string; shareLabel?: string } | null;

const inviteLink = async (token: string) => `${await appOrigin()}/convite/${token}`;

function shareFor(channel: "email" | "whatsapp", destination: string, text: string): { share: string; shareLabel: string } {
  return channel === "whatsapp"
    ? { share: whatsappShareLink(destination, text), shareLabel: "Mandar pelo WhatsApp" }
    : { share: mailtoLink(destination, "Convite para a MargoAI", text), shareLabel: "Mandar por e-mail" };
}

/**
 * W04 "Convidar pessoa", P14 "Convidar pelo WhatsApp": 7 days, single use (04 §8). The Dono sends the
 * link from their own WhatsApp or e-mail (D36: WhatsApp is manual until the platform). Every Dono gets
 * security_event (04 §9 "Pessoa nova"), always by e-mail.
 */
export async function invitePersonAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const m = await gate();
  const role = form.get("perfil");
  const channel = form.get("canal") === "email" ? "email" : "whatsapp";
  const raw = String(form.get("contato") ?? "");
  const destination = channel === "email" ? normalizeEmail(raw) : normalizeWhatsapp(raw);
  const name = String(form.get("nome") ?? "").trim().slice(0, 80);
  if (!isRole(role)) return { error: "Escolha o perfil." };
  if (!destination) return { error: channel === "email" ? "Confira o e-mail." : "Confira o número do WhatsApp com DDD." };
  const kitchens = role === "dono" ? [] : form.getAll("cozinha").map(String);
  const { token, hash } = newInviteToken();
  const { error } = await adminClient().rpc("invite_create", {
    p_actor: m.personId,
    p_account: m.account.id,
    p_name: name,
    p_role: role,
    p_kitchens: kitchens,
    p_channel: channel,
    p_destination: destination,
    p_token_hash: hash,
    ...(await rpcMeta()),
  });
  if (error) return { error: peopleError(error.message) };
  await notify(notifyDeps(), {
    code: "security_event",
    accountId: m.account.id,
    message: { subject: "Pessoa nova na conta", body: `${m.name} convidou ${name || destination} para a conta ${m.account.name} como ${PROFILE_LABEL[role]}.` },
  });
  revalidatePath(PATH);
  const link = await inviteLink(token);
  return { link, ...shareFor(channel, destination, inviteText(m.account.name, m.name, role, link)) };
}

/** W04 "Reenviar convite": new link, 7 more days; the old link stops working. */
export async function resendInviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const m = await gate();
  const db = adminClient();
  const { data: inv } = await db.from("invite").select("id, role, channel, destination").eq("id", String(form.get("convite") ?? "")).eq("account_id", m.account.id).maybeSingle();
  if (!inv) return { error: peopleError(null) };
  const { token, hash } = newInviteToken();
  const { error } = await db.rpc("invite_resend", { p_actor: m.personId, p_invite: inv.id, p_token_hash: hash, ...(await rpcMeta()) });
  if (error) return { error: peopleError(error.message) };
  revalidatePath(PATH);
  const link = await inviteLink(token);
  return { link, ...shareFor(inv.channel, inv.destination, inviteText(m.account.name, m.name, inv.role, link)) };
}
