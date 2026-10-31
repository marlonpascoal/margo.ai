// TEST ONLY. Compiled only when MARGO_E2E_ROUTES=1 (next.config.ts); never in a preview or production build.
// One FakeAsaasClient per dev server, published where lib/billing/deps.ts looks for it on the local stack.
import { ASAAS_E2E_OVERRIDE } from "@/lib/billing/deps";
import { FakeAsaasClient } from "@/lib/billing/fake-asaas";

export function e2eAsaas(): FakeAsaasClient {
  const g = globalThis as Record<symbol, unknown>;
  if (!(g[ASAAS_E2E_OVERRIDE] instanceof FakeAsaasClient)) {
    g[ASAAS_E2E_OVERRIDE] = new FakeAsaasClient((id) => `/teste-e2e/asaas/checkout?id=${encodeURIComponent(id)}`);
  }
  return g[ASAAS_E2E_OVERRIDE] as FakeAsaasClient;
}

export const e2eOnly = () => process.env.MARGO_ENV === "local" && process.env.MARGO_E2E_ROUTES === "1";
