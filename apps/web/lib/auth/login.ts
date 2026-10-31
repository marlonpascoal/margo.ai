// E-mail code login for console (C00) and portal (P15, W06): 04 §8, D35.
// The same answer goes to every address, invited or not, so the form never reveals who has access.
import { createHash } from "node:crypto";
import { afterFailure, afterSend, canSend, canVerify, emptyGuard, type Guard, type Surface } from "./rules";

export const MESSAGES = {
  // P15 copy.
  sent: "Mandamos um código de 6 números para o seu e-mail. Ele vale por 10 minutos.",
  // Not drawn; same style as P15.
  tooSoon: "Espere um minuto para pedir outro código.",
  locked: "Muitas tentativas. Tente de novo em 15 minutos.",
  wrong: "Código errado. Confira e tente de novo.",
  expired: "Código vencido. Peça um novo.",
} as const;

export interface LoginPerson {
  id: string;
  authUserId: string | null;
  accountIds: string[];
  donoAccountIds: string[];
}

export interface SessionRow {
  personId: string;
  surface: Surface;
  authSessionId: string;
  deviceKeyHash: string;
  userAgent: string | null;
  ipCity: string | null;
}

export interface AuditRow {
  action: string;
  personId: string;
  accountId: string | null;
  actorKind: "person" | "staff";
}

export interface LoginStore {
  getGuard(email: string): Promise<Guard>;
  saveGuard(email: string, guard: Guard): Promise<void>;
  /** The person allowed on this surface: staff for console, a membership for portal. */
  findPerson(email: string, surface: Surface): Promise<LoginPerson | null>;
  linkAuthUser(personId: string, authUserId: string): Promise<void>;
  deviceHistory(personId: string, deviceKeyHash: string): Promise<{ anyDevice: boolean; thisDevice: boolean }>;
  createSession(row: SessionRow): Promise<string>;
  /** Queues security_event (04 §9) for the Donos of these accounts. */
  notifyNewDevice(personId: string, accountIds: string[], userAgent: string | null): Promise<void>;
  audit(rows: AuditRow[]): Promise<void>;
}

/** Supabase Auth e-mail OTP, or a fake in tests. */
export interface AuthGateway {
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<{ userId: string; sessionId: string } | null>;
}

export interface LoginDeps {
  store: LoginStore;
  gateway: AuthGateway;
  now: () => Date;
}

export interface RequestContext {
  userAgent: string | null;
  ipCity: string | null;
  /** Random value kept in a long-lived httpOnly cookie; only its hash is stored. */
  deviceKey: string;
}

export type SendResult = { ok: boolean; message: string };
export type VerifyResult = { ok: true; personId: string; sessionDeviceId: string } | { ok: false; message: string };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const hashDeviceKey = (key: string) => createHash("sha256").update(key).digest("hex");

function refusal(reason: "locked" | "too_soon" | "expired"): string {
  return reason === "locked" ? MESSAGES.locked : reason === "too_soon" ? MESSAGES.tooSoon : MESSAGES.expired;
}

export async function sendCode(deps: LoginDeps, input: { email: string; surface: Surface }): Promise<SendResult> {
  const email = normalizeEmail(input.email);
  const now = deps.now();
  const guard = await deps.store.getGuard(email);
  const decision = canSend(guard, now);
  if (!decision.ok) return { ok: false, message: refusal(decision.reason) };

  // Record the send for every address, so timing and later answers match for unknown ones.
  await deps.store.saveGuard(email, afterSend(guard, now));
  const person = await deps.store.findPerson(email, input.surface);
  if (person) await deps.gateway.sendCode(email);
  return { ok: true, message: MESSAGES.sent };
}

export async function verifyCode(
  deps: LoginDeps,
  input: { email: string; code: string; surface: Surface; ctx: RequestContext },
): Promise<VerifyResult> {
  const email = normalizeEmail(input.email);
  const now = deps.now();
  const guard = await deps.store.getGuard(email);
  const decision = canVerify(guard, now);
  if (!decision.ok) return { ok: false, message: refusal(decision.reason) };

  const person = await deps.store.findPerson(email, input.surface);
  const auth = person && /^\d{6}$/.test(input.code) ? await deps.gateway.verifyCode(email, input.code) : null;
  if (!person || !auth || (person.authUserId !== null && person.authUserId !== auth.userId)) {
    const next = afterFailure(guard, now);
    await deps.store.saveGuard(email, next);
    return { ok: false, message: next.lockedUntil ? MESSAGES.locked : MESSAGES.wrong };
  }

  await deps.store.saveGuard(email, emptyGuard());
  if (person.authUserId === null) await deps.store.linkAuthUser(person.id, auth.userId);

  const deviceKeyHash = hashDeviceKey(input.ctx.deviceKey);
  const history = await deps.store.deviceHistory(person.id, deviceKeyHash);
  const sessionDeviceId = await deps.store.createSession({
    personId: person.id,
    surface: input.surface,
    authSessionId: auth.sessionId,
    deviceKeyHash,
    userAgent: input.ctx.userAgent,
    ipCity: input.ctx.ipCity,
  });

  // P15: a login on a device this person never used raises security_event. The very first login does not.
  if (input.surface === "portal" && history.anyDevice && !history.thisDevice) {
    await deps.store.notifyNewDevice(person.id, person.accountIds, input.ctx.userAgent);
  }

  await deps.store.audit(
    input.surface === "console"
      ? [{ action: "login", personId: person.id, accountId: null, actorKind: "staff" }]
      : person.accountIds.map((accountId) => ({ action: "login", personId: person.id, accountId, actorKind: "person" as const })),
  );
  return { ok: true, personId: person.id, sessionDeviceId };
}
