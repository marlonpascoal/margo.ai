// P14 / W04 Pessoas e acessos (design/P14-Pessoas.dc.html, design/W04-Pessoas.dc.html, 05 §B, 04 §5,
// §8, D33, D35). The Dono sees everyone and the pending invites; others see only themselves. Changes go
// through the SQL functions of migration 20261117000020 (Dono check, security_lock, last Dono, audit).
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@/lib/supabase/admin";
import type { MemberRole } from "@/lib/permissions";
import { dayMonSP, PROFILE_LABEL, shortKitchen, whatsappShort, whenLabel } from "./scope";

export interface PersonRow {
  kind: "member" | "invite";
  /** membership id or invite id */
  id: string;
  name: string;
  /** W04 second line: e-mail, "WhatsApp (43) 9…" or "convite enviado 29/out" */
  contact: string;
  role: MemberRole;
  allKitchens: boolean;
  kitchenIds: string[];
  /** W04 "Cozinhas": "todas", "Centro" */
  kitchensShort: string;
  /** P14: "todas as cozinhas", "Cozinha Centro" */
  kitchensLong: string;
  /** W04 "Último acesso": "hoje 08:12", "27/out", "pendente" */
  lastAccess: string;
  isSelf: boolean;
}

export interface PeopleView {
  rows: PersonRow[];
  kitchens: { id: string; name: string; short: string }[];
}

export interface PeopleInput {
  kitchens: { id: string; name: string }[];
  members: {
    id: string;
    person_id: string;
    role: MemberRole;
    all_kitchens: boolean;
    kitchen_ids: string[];
    name: string;
    email: string | null;
    whatsapp: string | null;
    last_seen: string | null;
  }[];
  invites: { id: string; name: string | null; destination: string; role: MemberRole; kitchen_ids: string[]; created_at: string }[];
}

const ROLE_ORDER: MemberRole[] = ["dono", "financeiro", "gerente"];

function scopeLabels(all: boolean, ids: string[], kitchens: Map<string, string>): [string, string] {
  if (all || ids.length === 0) return ["todas", "todas as cozinhas"];
  const names = ids.map((id) => kitchens.get(id)).filter((n): n is string => !!n).sort();
  return [names.map(shortKitchen).join(", "), names.join(", ")];
}

/** W04 rows. Pure: loadPeople does the I/O and applies "others see only themselves". */
export function peopleView(input: PeopleInput, selfPersonId: string, now: Date): PeopleView {
  const kmap = new Map(input.kitchens.map((k) => [k.id, k.name]));
  const members = [...input.members]
    .sort((a, b) => Number(b.person_id === selfPersonId) - Number(a.person_id === selfPersonId) || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name))
    .map((x): PersonRow => {
      const [short, long] = scopeLabels(x.all_kitchens, x.kitchen_ids, kmap);
      return {
        kind: "member",
        id: x.id,
        name: x.name,
        contact: x.email ?? (x.whatsapp ? whatsappShort(x.whatsapp) : ""),
        role: x.role,
        allKitchens: x.all_kitchens,
        kitchenIds: x.kitchen_ids,
        kitchensShort: short,
        kitchensLong: long,
        lastAccess: x.last_seen ? whenLabel(x.last_seen, now) : "",
        isSelf: x.person_id === selfPersonId,
      };
    });
  const invites = input.invites.map((i): PersonRow => {
    const [short, long] = scopeLabels(i.kitchen_ids.length === 0, i.kitchen_ids, kmap);
    return {
      kind: "invite",
      id: i.id,
      name: i.name ?? i.destination,
      contact: `convite enviado ${dayMonSP(i.created_at)}`,
      role: i.role,
      allKitchens: i.kitchen_ids.length === 0,
      kitchenIds: i.kitchen_ids,
      kitchensShort: short,
      kitchensLong: long,
      lastAccess: "pendente",
      isSelf: false,
    };
  });
  return {
    rows: [...members, ...invites],
    kitchens: [...input.kitchens].sort((a, b) => a.name.localeCompare(b.name)).map((k) => ({ ...k, short: shortKitchen(k.name) })),
  };
}

/** P14/W04 data. `dono` false: only the person's own row (05 P14 "others see only themselves"). */
export async function loadPeople(db: Db, accountId: string, self: { personId: string; dono: boolean }, now = new Date()): Promise<PeopleView> {
  let mq = db.from("membership").select("id, person_id, role, all_kitchens, person(name, email, whatsapp_e164), membership_kitchen(kitchen_id)").eq("account_id", accountId);
  if (!self.dono) mq = mq.eq("person_id", self.personId);
  const [kitchens, members, invites] = await Promise.all([
    db.from("kitchen").select("id, name").eq("account_id", accountId),
    mq,
    self.dono
      ? db.from("invite").select("id, name, destination, role, kitchen_ids, created_at").eq("account_id", accountId).is("accepted_at", null).order("created_at")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [kitchens, members, invites]) if (r.error) throw new Error(r.error.message);
  const personIds = (members.data ?? []).map((x) => x.person_id);
  const { data: devices, error } = await db.from("session_device").select("person_id, last_seen_at").in("person_id", personIds.length ? personIds : ["00000000-0000-0000-0000-000000000000"]);
  if (error) throw new Error(error.message);
  const last = new Map<string, string>();
  for (const d of devices ?? []) if (!last.has(d.person_id) || d.last_seen_at > last.get(d.person_id)!) last.set(d.person_id, d.last_seen_at);
  return peopleView(
    {
      kitchens: kitchens.data ?? [],
      members: (members.data ?? []).map((x) => ({
        id: x.id,
        person_id: x.person_id,
        role: x.role,
        all_kitchens: x.all_kitchens,
        kitchen_ids: (x.membership_kitchen ?? []).map((k) => k.kitchen_id),
        name: x.person?.name ?? "",
        email: x.person?.email ?? null,
        whatsapp: x.person?.whatsapp_e164 ?? null,
        last_seen: last.get(x.person_id) ?? null,
      })),
      invites: (invites.data ?? []) as PeopleInput["invites"],
    },
    self.personId,
    now,
  );
}

/** Invite token: shown once in the link, only its sha256 stored (as the seed's invite). */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

/** W04 matrix "O que cada perfil pode fazer", verbatim; mirrors 04 §5 and lib/permissions.ts. */
export const MATRIX: { a: string; d: string; f: string; g: string }[] = (() => {
  const S = "sim";
  const N = "·";
  const O = "só a dele";
  return [
    { a: "Ver fechamento e quanto sobra", d: S, f: S, g: O },
    { a: "Ver e marcar contestações", d: S, f: S, g: O },
    { a: "Mandar notas de compra", d: S, f: S, g: O },
    { a: "Ver raio-X de preço", d: S, f: S, g: O },
    { a: "Escolher cozinhas na análise", d: S, f: N, g: N },
    { a: "Plano, cartão e faturas", d: S, f: N, g: N },
    { a: "Convidar e remover pessoas", d: S, f: N, g: N },
  ];
})();

export { PROFILE_LABEL };

/**
 * E04, 04 §8: end of this person's active security_lock in the account (ISO), or null when their plan and
 * people changes are open. The lock holds back only the person who changed a login contact (Marlon, 01/nov).
 */
export async function peopleLockUntil(db: Db, accountId: string, personId: string): Promise<string | null> {
  const { data, error } = await db.rpc("people_lock_until", { p_account: accountId, p_person: personId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
