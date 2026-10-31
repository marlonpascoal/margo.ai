// The Asaas parser against sandbox recordings (06 §4, D40: no invented provider responses). The recordings
// are made by Marlon with scripts/record_asaas.mjs (fixtures/asaas/README.md). Until they exist, these
// tests are skipped; once fixtures/asaas/webhooks/<EVENT>.json land, they run with no code change.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAsaasEvent, type BillingEventKind } from "./asaas-parse";

const DIR = fileURLToPath(new URL("../../../../fixtures/asaas/webhooks", import.meta.url));
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];

const EXPECTED: Record<string, BillingEventKind> = {
  PAYMENT_CONFIRMED: "payment_confirmed",
  PAYMENT_RECEIVED: "payment_confirmed",
  PAYMENT_OVERDUE: "payment_overdue",
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "payment_refused",
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: "payment_refused",
  SUBSCRIPTION_CREATED: "subscription_created",
  SUBSCRIPTION_DELETED: "subscription_deleted",
};

describe.skipIf(files.length === 0)("E01 Asaas webhook recordings (waiting for recordings, see fixtures/asaas/README.md)", () => {
  for (const file of files) {
    it(`E01_parse_recorded_${file}`, () => {
      const raw = JSON.parse(readFileSync(path.join(DIR, file), "utf8"));
      const ev = parseAsaasEvent(raw);
      const name = file.replace(/(\.\d+)?\.json$/, "");
      expect(ev.asaasEvent).toBe(name);
      expect(ev.kind).toBe(EXPECTED[name] ?? "unknown");
      expect(ev.eventId).toMatch(/\S/);
      if (ev.kind.startsWith("payment_")) {
        expect(ev.paymentId).toMatch(/^pay_/);
        expect(ev.customerId).toMatch(/^cus_/);
        expect(ev.valueCents).toBeGreaterThan(0);
        expect(ev.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (ev.kind.startsWith("subscription_")) expect(ev.subscriptionId).toMatch(/^sub_/);
    });
  }
});

if (files.length === 0) it.skip("E01_parse_recorded_webhooks: waiting for recordings, see fixtures/asaas/README.md", () => {});
