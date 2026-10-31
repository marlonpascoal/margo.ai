// In-memory AsaasClient for unit tests and the e2e-only wiring (app/teste-e2e/asaas). It records what our
// code asked for and answers with ids of its own; it does not imitate Asaas response bodies (06 §4).
import type { AsaasCheckoutInput, AsaasClient, AsaasCustomerInput, AsaasPaymentInput } from "./asaas";

export class FakeAsaasClient implements AsaasClient {
  customers: (AsaasCustomerInput & { id: string })[] = [];
  checkouts: (AsaasCheckoutInput & { id: string; url: string })[] = [];
  valueUpdates: { subscriptionId: string; valueCents: number }[] = [];
  payments: (AsaasPaymentInput & { id: string })[] = [];
  /** Next call of this method throws (to test failures). */
  failNext: Partial<Record<keyof AsaasClient, boolean>> = {};
  private seq = 0;

  /** checkoutUrl(id, input): where createCheckout sends the person; e2e points it at a test page. */
  constructor(private readonly checkoutUrl: (id: string, input: AsaasCheckoutInput) => string = (id) => `https://checkout.fake.local/${id}`) {}

  private fail(m: keyof AsaasClient) {
    if (this.failNext[m]) {
      this.failNext[m] = false;
      throw new Error(`fake ${m} failure`);
    }
  }

  private next(prefix: string) {
    return `${prefix}_fake${String(++this.seq).padStart(4, "0")}`;
  }

  async createCustomer(input: AsaasCustomerInput) {
    this.fail("createCustomer");
    const id = this.next("cus");
    this.customers.push({ ...input, id });
    return { id };
  }

  async createCheckout(input: AsaasCheckoutInput) {
    this.fail("createCheckout");
    const id = this.next("chk");
    const url = this.checkoutUrl(id, input);
    this.checkouts.push({ ...input, id, url });
    return { id, url };
  }

  async updateSubscriptionValue(subscriptionId: string, valueCents: number) {
    this.fail("updateSubscriptionValue");
    this.valueUpdates.push({ subscriptionId, valueCents });
  }

  async createPayment(input: AsaasPaymentInput) {
    this.fail("createPayment");
    const id = this.next("pay");
    this.payments.push({ ...input, id });
    return { id };
  }
}
