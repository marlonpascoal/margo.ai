// E-mail code login for console (C00) and portal (P15, W06): 04 §8, D35.
// The same answer goes to every address, invited or not, so the form never reveals who has access.
import { createHash } from "node:crypto";
import { afterFailure, afterSend, afterSuccess, canSend, canVerify, type Guard, type Surface } from "./rules";

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

/** Auth refused to send because it sent one too recently; answered like our own 60 s rule. */
export class AuthRateLimited extends Error {
  constructor(message = "auth rate limited") {
    super(message);
    this.name = "AuthRateLimited";
  }
}

/** Supabase Auth e-mail OTP, or a fake in tests. `sendCode` throws AuthRateLimited when Auth refuses as too soon. */
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
  if (person) {
    try {
      await deps.gateway.sendCode(email);
    } catch (e) {
      if (e instanceof AuthRateLimited) return { ok: false, message: MESSAGES.tooSoon };
      throw e;
    }
  }
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

  await deps.store.saveGuard(email, afterSuccess(guard));
  const sessionDeviceId = await startSession(deps.store, person, auth.userId, { surface: input.surface, authSessionId: auth.sessionId, ctx: input.ctx });
  return { ok: true, personId: person.id, sessionDeviceId };
}

/**
 * After the person proved who they are (code, or the P18 invite link): links the auth user, records the
 * device, raises security_event for a new device (P15) and audits the login. Returns the session_device id.
 */
export async function startSession(
  store: LoginStore,
  person: LoginPerson,
  authUserId: string,
  s: { surface: Surface; authSessionId: string; ctx: RequestContext },
): Promise<string> {
  if (person.authUserId === null) await store.linkAuthUser(person.id, authUserId);

  const deviceKeyHash = hashDeviceKey(s.ctx.deviceKey);
  const history = await store.deviceHistory(person.id, deviceKeyHash);
  const sessionDeviceId = await store.createSession({
    personId: person.id,
    surface: s.surface,
    authSessionId: s.authSessionId,
    deviceKeyHash,
    userAgent: s.ctx.userAgent,
    ipCity: s.ctx.ipCity,
  });

  // P15: a login on a device this person never used raises security_event. The very first login does not.
  if (s.surface === "portal" && history.anyDevice && !history.thisDevice) {
    await store.notifyNewDevice(person.id, person.accountIds, s.ctx.userAgent);
  }

  await store.audit(
    s.surface === "console"
      ? [{ action: "login", personId: person.id, accountId: null, actorKind: "staff" }]
      : person.accountIds.map((accountId) => ({ action: "login", personId: person.id, accountId, actorKind: "person" as const })),
  );
  return sessionDeviceId;
}
