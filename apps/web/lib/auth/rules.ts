// Login code and session rules (04 §8, D35). Pure functions; callers pass the clock.

export type Surface = "console" | "portal";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60_000;
export const RESEND_MS = 60_000;
export const SESSION_TTL_MS: Record<Surface, number> = {
  console: 12 * 60 * 60_000,
  portal: 30 * 24 * 60 * 60_000,
};

/** Per e-mail state of the code currently issued. */
export interface Guard {
  sentAt: Date | null;
  attempts: number;
  lockedUntil: Date | null;
}

export type Decision = { ok: true } | { ok: false; reason: "locked" | "too_soon"; retryAt: Date } | { ok: false; reason: "expired" };

export const emptyGuard = (): Guard => ({ sentAt: null, attempts: 0, lockedUntil: null });

const isLocked = (g: Guard, now: Date) => g.lockedUntil !== null && now < g.lockedUntil;

/** A lock that has run out clears the tries; a new code then starts clean. */
function settle(g: Guard, now: Date): Guard {
  return g.lockedUntil !== null && now >= g.lockedUntil ? { sentAt: null, attempts: 0, lockedUntil: null } : g;
}

export function canSend(guard: Guard, now: Date): Decision {
  const g = settle(guard, now);
  if (isLocked(g, now)) return { ok: false, reason: "locked", retryAt: g.lockedUntil! };
  if (g.sentAt && now.getTime() - g.sentAt.getTime() < RESEND_MS) {
    return { ok: false, reason: "too_soon", retryAt: new Date(g.sentAt.getTime() + RESEND_MS) };
  }
  return { ok: true };
}

/** Resending does not reset the tries, so a resend loop cannot buy more guesses. */
export function afterSend(guard: Guard, now: Date): Guard {
  return { ...settle(guard, now), sentAt: now };
}

export function canVerify(guard: Guard, now: Date): Decision {
  const g = settle(guard, now);
  if (isLocked(g, now)) return { ok: false, reason: "locked", retryAt: g.lockedUntil! };
  if (!g.sentAt || now.getTime() - g.sentAt.getTime() >= CODE_TTL_MS) return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * After a successful login the tries start over, but the send time stays: Supabase Auth refuses another
 * code within its own 60 s (max_frequency), so our 60 s rule must keep answering first.
 */
export function afterSuccess(guard: Guard): Guard {
  return { sentAt: guard.sentAt, attempts: 0, lockedUntil: null };
}

export function afterFailure(guard: Guard, now: Date): Guard {
  const g = settle(guard, now);
  const attempts = g.attempts + 1;
  return attempts >= MAX_ATTEMPTS
    ? { sentAt: null, attempts, lockedUntil: new Date(now.getTime() + LOCK_MS) }
    : { ...g, attempts };
}

export function sessionExpired(startedAt: Date, surface: Surface, now: Date): boolean {
  return now.getTime() - startedAt.getTime() >= SESSION_TTL_MS[surface];
}
