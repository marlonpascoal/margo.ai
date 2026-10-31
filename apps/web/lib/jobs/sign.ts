// Signed wake-up (02 §4.2, A07): body {job_id, ts, sig}, sig = hex(HMAC-SHA256(key, `${job_id}|${ts}`)),
// ts in Unix seconds. Workers verify with workers/common margo_common.signing.
// Only node:crypto here, so the Python tests can run this file through node to check both sides agree.
import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_AGE_SECONDS = 5 * 60;

export type WakeupBody = { job_id: string; ts: number; sig: string };

function sig(key: string | Uint8Array, jobId: string, ts: number): string {
  return createHmac("sha256", key).update(`${jobId}|${ts}`).digest("hex");
}

export function signWakeup(jobId: string, key: string | Uint8Array, now: Date): WakeupBody {
  if (key.length === 0) throw new Error("wake-up signing key is empty");
  const ts = Math.floor(now.getTime() / 1000);
  return { job_id: jobId, ts, sig: sig(key, jobId, ts) };
}

/** The job id of a valid wake-up, or null. Constant-time compare. */
export function verifyWakeup(body: Partial<Record<keyof WakeupBody, unknown>>, key: string | Uint8Array, now: Date): string | null {
  const { job_id: jobId, ts, sig: given } = body;
  if (key.length === 0 || typeof jobId !== "string" || !Number.isInteger(ts) || typeof given !== "string" || !given) return null;
  const expected = Buffer.from(sig(key, jobId, ts as number));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (Math.abs(now.getTime() / 1000 - (ts as number)) > MAX_AGE_SECONDS) return null;
  return jobId;
}
