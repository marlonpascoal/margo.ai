// Pure helpers of the owner account screens (P13/W02, P12/W03, P14/W04, P03/W07). No I/O: unit-tested.
import type { MemberRole } from "@/lib/permissions";

/** Who is looking: the role and the kitchen scope of their membership (04 §5, D33). */
export interface Scope {
  role: MemberRole;
  allKitchens: boolean;
  kitchenIds: readonly string[];
}

/**
 * A03: all kitchens, or the chosen ones. A store or close without kitchen (account-wide) is visible only
 * with all kitchens, as app.sees_kitchen in the RLS migration.
 */
export function seesKitchen(scope: Scope, kitchenId: string | null | undefined): boolean {
  if (scope.allKitchens) return true;
  return !!kitchenId && scope.kitchenIds.includes(kitchenId);
}

/** "Cozinha Centro" -> "Centro", as W02's kitchen picker and W03's "Cozinha e app" column draw it. */
export const shortKitchen = (name: string) => name.replace(/^Cozinha\s+/i, "");

const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SP = "America/Sao_Paulo";

function spParts(d: Date): { day: string; time: string; dd: string; mon: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: SP, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, dd: p.day, mon: MON[Number(p.month) - 1] };
}

/** "hoje 08:12", "ontem 17:40", "27/out" in São Paulo time (W04 "Último acesso", W02 "Dados chegando"). */
export function whenLabel(iso: string, now: Date): string {
  const at = spParts(new Date(iso));
  const today = spParts(now);
  const yesterday = spParts(new Date(now.getTime() - 86_400_000));
  if (at.day === today.day) return `hoje ${at.time}`;
  if (at.day === yesterday.day) return `ontem ${at.time}`;
  return `${at.dd}/${at.mon}`;
}

/** "29/out" for a date or instant in São Paulo. */
export const dayMonSP = (iso: string) => {
  const p = spParts(new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso));
  return `${p.dd}/${p.mon}`;
};

/** "30/11 10:00" for the lock banner. */
export function dayTimeSP(iso: string): string {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: SP, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return f.format(d).replace(",", "");
}

// People (P14/W04) ---------------------------------------------------------------------------------

/** Profile names as drawn in W04. */
export const PROFILE_LABEL: Record<MemberRole, string> = { dono: "Dono", financeiro: "Financeiro", gerente: "Gerente de cozinha" };

/** "(43) 9…": the WhatsApp number shortened as W04 draws it. */
export function whatsappShort(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  return `WhatsApp (${local.slice(0, 2)}) ${local.slice(2, 3)}…`;
}

/** Brazilian WhatsApp typed by the Dono: "(43) 99999-1234", "43999991234", "+55 43 ..." -> "+5543999991234". */
export function normalizeWhatsapp(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return `+${d}`;
}

export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Error keys raised by the people functions (migration 20261117000020), as the screen says them. Not drawn. */
export const PEOPLE_ERRORS: Record<string, string> = {
  E04_last_dono: "Toda conta precisa de pelo menos um Dono. Faça outra pessoa Dono antes.",
  E04_locked: "Você trocou um contato de login. Por 24 horas, você não pode mudar pessoas.",
  not_dono: "Só o Dono convida, muda perfil e remove pessoas.",
  no_kitchen: "Escolha pelo menos uma cozinha.",
  kitchen_not_in_account: "Escolha cozinhas desta conta.",
  already_member: "Esse contato já tem acesso à conta.",
  invite_used: "Esse convite já foi aceito.",
};

export function peopleError(message: string | undefined | null): string {
  const key = Object.keys(PEOPLE_ERRORS).find((k) => message?.includes(k));
  return key ? PEOPLE_ERRORS[key] : "Não deu certo. Tente de novo.";
}

export const INVITE_MESSAGES = {
  // Not drawn; same style as the other invite errors.
  gerenteNeedsKitchen: "Escolha pelo menos uma cozinha para o Gerente de cozinha.",
} as const;

/**
 * 04 §5 (Marlon, 31/out): the kitchens an invite carries. A Gerente must get at least one; for Financeiro no
 * kitchen chosen means all kitchens; a Dono always sees all.
 */
export function inviteKitchens(role: MemberRole, chosen: string[]): { ok: true; kitchens: string[] } | { ok: false; error: string } {
  if (role === "dono") return { ok: true, kitchens: [] };
  const kitchens = chosen.map((k) => k.trim()).filter(Boolean);
  if (role === "gerente" && kitchens.length === 0) return { ok: false, error: INVITE_MESSAGES.gerenteNeedsKitchen };
  return { ok: true, kitchens };
}

/** The text that goes with an invite link (P14 "Convidar pelo WhatsApp"). Not drawn. */
export function inviteText(accountName: string, inviter: string, role: MemberRole, link: string): string {
  return `${inviter} convidou você para ver a conta ${accountName} na MargoAI como ${PROFILE_LABEL[role]}. O convite vale por 7 dias: ${link}`;
}

export function whatsappShareLink(phoneE164: string | null, text: string): string {
  const to = phoneE164 ? phoneE164.replace(/\D/g, "") : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Contestations (P12/W03) -------------------------------------------------------------------------

/** What the owner may do to a contestation (04 §3): the person events of public.contestation_mark. */
export const OWNER_EVENTS = ["ja_contestei", "foi_combinado_sim", "foi_combinado_nao", "foi_negada"] as const;
export type OwnerEvent = (typeof OWNER_EVENTS)[number];
export const isOwnerEvent = (v: unknown): v is OwnerEvent => (OWNER_EVENTS as readonly unknown[]).includes(v);
