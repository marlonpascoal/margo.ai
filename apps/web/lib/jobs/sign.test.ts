// A07: the web side of the signed wake-up (02 §4.2). The Python verifier checks the same format
// (workers/common/tests/test_runner.py runs this signer through node).
import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWakeup, verifyWakeup } from "./sign";

const key = randomBytes(32); // throwaway, never committed
const jobId = "6f1f0c2e-2b8e-4b7e-9d3a-1c2d3e4f5a6b";
const now = new Date("2026-10-31T09:00:00Z");

describe("signWakeup", () => {
  it("A07: body is {job_id, ts, sig} with sig = HMAC-SHA256(key, job_id|ts)", () => {
    const ts = Math.floor(now.getTime() / 1000);
    expect(signWakeup(jobId, key, now)).toEqual({
      job_id: jobId,
      ts,
      sig: createHmac("sha256", key).update(`${jobId}|${ts}`).digest("hex"),
    });
  });

  it("A07: takes the key as the env string too", () => {
    const k = randomBytes(16).toString("hex");
    expect(verifyWakeup(signWakeup(jobId, k, now), Buffer.from(k), now)).toBe(jobId);
  });

  it("refuses an empty key", () => {
    expect(() => signWakeup(jobId, "", now)).toThrow();
  });
});

describe("verifyWakeup", () => {
  const body = signWakeup(jobId, key, now);

  it("A07: accepts a fresh signed call", () => {
    expect(verifyWakeup(body, key, now)).toBe(jobId);
    expect(verifyWakeup(body, key, new Date(now.getTime() + 4 * 60_000))).toBe(jobId);
  });

  it("A07: rejects unsigned, tampered, wrong-key and stale calls", () => {
    expect(verifyWakeup({ job_id: jobId, ts: body.ts }, key, now)).toBeNull();
    expect(verifyWakeup({ ...body, job_id: "00000000-0000-4000-8000-000000000000" }, key, now)).toBeNull();
    expect(verifyWakeup({ ...body, ts: body.ts - 1 }, key, now)).toBeNull();
    expect(verifyWakeup({ ...body, sig: body.sig.replace(/.$/, (c) => (c === "0" ? "1" : "0")) }, key, now)).toBeNull();
    expect(verifyWakeup(body, randomBytes(32), now)).toBeNull();
    expect(verifyWakeup(body, key, new Date(now.getTime() + 5 * 60_000 + 1000))).toBeNull();
    expect(verifyWakeup(body, key, new Date(now.getTime() - 6 * 60_000))).toBeNull();
  });
});
