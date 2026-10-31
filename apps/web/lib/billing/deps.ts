// Production wiring of billing. Server code only.
import { alertDeps } from "@/lib/notify/deps";
import { adminClient } from "@/lib/supabase/admin";
import { asaasConfigFromEnv, HttpAsaasClient, type AsaasClient } from "./asaas";
import type { BillingDeps } from "./service";
import { SupabaseBillingStore } from "./supabase-store";

/**
 * The e2e-only page app/teste-e2e/asaas (compiled only with MARGO_E2E_ROUTES=1) puts a fake client here.
 * It is honoured only on the local stack, so no preview or production server can be pointed at a fake.
 */
export const ASAAS_E2E_OVERRIDE = Symbol.for("margoai.asaas.e2e");

export function asaasClient(): AsaasClient {
  const override = (globalThis as Record<symbol, unknown>)[ASAAS_E2E_OVERRIDE] as AsaasClient | undefined;
  if (override && process.env.MARGO_ENV === "local" && process.env.MARGO_E2E_ROUTES === "1") return override;
  return new HttpAsaasClient(asaasConfigFromEnv());
}

export function billingDeps(): BillingDeps {
  return { store: new SupabaseBillingStore(adminClient()), asaas: asaasClient(), notify: alertDeps(), now: () => new Date() };
}
