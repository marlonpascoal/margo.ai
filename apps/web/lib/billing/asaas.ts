// Asaas adapter (06 §4, D27). Everything that talks to Asaas goes through AsaasClient, so tests use a fake
// (fake-asaas.ts) and the provider can change. No test replays an invented Asaas body: request and response
// shapes are checked against sandbox recordings once Marlon makes them (fixtures/asaas/README.md).
//
// Money crosses this boundary in centavos; HttpAsaasClient converts to the reais Asaas expects.

export interface AsaasCustomerInput {
  name: string;
  /** CNPJ, digits only. */
  cpfCnpj: string;
  email: string | null;
  /** Our account id, so a webhook can be matched even before the customer id is stored. */
  externalReference: string;
}

/** Hosted checkout with a recurring card charge (06 §4: chargeTypes RECURRENT, card only). */
export interface AsaasCheckoutInput {
  customerId: string;
  /** Monthly value in centavos: units x plan price (04 §7). */
  valueCents: number;
  /** First charge, yyyy-mm-dd in São Paulo: the trial end when converting during the trial (06 §4). */
  nextDueDate: string;
  /** What the person sees on the Asaas page ("MargoAI · plano Lucro"). */
  itemName: string;
  itemDescription: string;
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
  externalReference: string;
}

/** Single charge (pilot months 1 and 2, D37). Card only. */
export interface AsaasPaymentInput {
  customerId: string;
  valueCents: number;
  dueDate: string;
  description: string;
  /** "pilot_charge:<id>", so the payment webhook updates the pilot charge, not the subscription. */
  externalReference: string;
}

export interface AsaasClient {
  createCustomer(input: AsaasCustomerInput): Promise<{ id: string }>;
  createCheckout(input: AsaasCheckoutInput): Promise<{ id: string; url: string }>;
  /** 06 §4 "Units": new value from the next cycle on; pending payments keep their value. */
  updateSubscriptionValue(subscriptionId: string, valueCents: number): Promise<void>;
  createPayment(input: AsaasPaymentInput): Promise<{ id: string }>;
}

export const ASAAS_SANDBOX_URL = "https://api-sandbox.asaas.com";

export interface AsaasConfig {
  baseUrl: string;
  /** null when ASAAS_API_KEY is not set: every call then fails before leaving the server. */
  apiKey: string | null;
}

/** ASAAS_API_URL (default: the sandbox, 06 §4) and ASAAS_API_KEY, set on the platform only (D44). */
export function asaasConfigFromEnv(env: Record<string, string | undefined> = process.env): AsaasConfig {
  return { baseUrl: (env.ASAAS_API_URL || ASAAS_SANDBOX_URL).replace(/\/+$/, ""), apiKey: env.ASAAS_API_KEY || null };
}

export const isSandbox = (config: AsaasConfig) => config.baseUrl === ASAAS_SANDBOX_URL;

/** 3000 centavos -> 30 (Asaas takes reais as a JSON number). */
export const reaisValue = (cents: number) => Math.round(cents) / 100;

export class AsaasError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
  ) {
    super(`asaas ${endpoint} returned ${status}`);
  }
}

type Fetch = typeof fetch;

/**
 * Asaas REST v3 over fetch. Endpoint paths follow the Asaas documentation; the fields read from responses
 * are only `id` and the checkout `link`, to be confirmed against the first sandbox recording.
 */
export class HttpAsaasClient implements AsaasClient {
  constructor(
    private readonly config: AsaasConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call(method: "POST" | "PUT", path: string, body: unknown): Promise<Record<string, unknown>> {
    if (!this.config.apiKey) throw new Error("missing environment variable ASAAS_API_KEY");
    const started = Date.now();
    const res = await this.fetchImpl(`${this.config.baseUrl}/v3${path}`, {
      method,
      headers: { "content-type": "application/json", access_token: this.config.apiKey, "user-agent": "MargoAI" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    // 02 §8: one JSON line per external call, ids only, never the key or the body.
    const endpoint = path.replace(/\/(sub|cus|pay)_[A-Za-z0-9]+/g, "/:id");
    console.info(JSON.stringify({ service: "asaas", endpoint: `${method} ${endpoint}`, status: res.status, ms: Date.now() - started }));
    if (!res.ok) throw new AsaasError(endpoint, res.status);
    return (await res.json()) as Record<string, unknown>;
  }

  private static id(body: Record<string, unknown>, endpoint: string): string {
    if (typeof body.id !== "string" || !body.id) throw new Error(`asaas ${endpoint}: response without id`);
    return body.id;
  }

  async createCustomer(input: AsaasCustomerInput) {
    const body = await this.call("POST", "/customers", {
      name: input.name,
      cpfCnpj: input.cpfCnpj,
      email: input.email ?? undefined,
      externalReference: input.externalReference,
      notificationDisabled: true,
    });
    return { id: HttpAsaasClient.id(body, "customers") };
  }

  async createCheckout(input: AsaasCheckoutInput) {
    const body = await this.call("POST", "/checkouts", {
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      customer: input.customerId,
      externalReference: input.externalReference,
      callback: { successUrl: input.successUrl, cancelUrl: input.cancelUrl, expiredUrl: input.expiredUrl },
      items: [{ name: input.itemName, description: input.itemDescription, quantity: 1, value: reaisValue(input.valueCents) }],
      subscription: { cycle: "MONTHLY", nextDueDate: input.nextDueDate },
    });
    const id = HttpAsaasClient.id(body, "checkouts");
    if (typeof body.link !== "string" || !/^https:\/\//.test(body.link)) throw new Error("asaas checkouts: response without link");
    return { id, url: body.link };
  }

  async updateSubscriptionValue(subscriptionId: string, valueCents: number) {
    await this.call("PUT", `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      value: reaisValue(valueCents),
      updatePendingPayments: false,
    });
  }

  async createPayment(input: AsaasPaymentInput) {
    const body = await this.call("POST", "/payments", {
      customer: input.customerId,
      billingType: "CREDIT_CARD",
      value: reaisValue(input.valueCents),
      dueDate: input.dueDate,
      description: input.description,
      externalReference: input.externalReference,
    });
    return { id: HttpAsaasClient.id(body, "payments") };
  }
}
