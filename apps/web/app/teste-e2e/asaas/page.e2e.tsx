// TEST ONLY (e2e/billing.e2e.ts). Compiled only when MARGO_E2E_ROUTES=1 (next.config.ts) and answering 404
// outside the local stack. No Asaas body is invented: events enter after the parser, as internal events.
//   /teste-e2e/asaas?acao=ligar                         installs the fake Asaas client
//   /teste-e2e/asaas?acao=evento&conta=G-01&tipo=payment_confirmed&id=evt_x
//                                                       delivers one internal event through handleAsaasWebhook
import { notFound } from "next/navigation";
import type { BillingEventIn, BillingEventKind } from "@/lib/billing/asaas-parse";
import { billingDeps } from "@/lib/billing/deps";
import { handleAsaasWebhook } from "@/lib/billing/webhook";
import { adminClient } from "@/lib/supabase/admin";
import { e2eAsaas, e2eOnly } from "./fake.e2e";

export const dynamic = "force-dynamic";

const KINDS: BillingEventKind[] = ["payment_confirmed", "payment_overdue", "payment_refused", "subscription_created", "subscription_deleted"];

export default async function AsaasProbe({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!e2eOnly()) notFound();
  const q = await searchParams;
  const fake = e2eAsaas();
  if (q.acao === "ligar") return <main data-asaas-fake="on">fake Asaas ligado</main>;
  if (q.acao !== "evento" || !q.conta || !q.id || !KINDS.includes(q.tipo as BillingEventKind)) notFound();

  const db = adminClient();
  const { data: account } = await db.from("account").select("id, code").eq("code", q.conta).maybeSingle();
  if (!account) notFound();
  const { data: sub } = await db.from("subscription").select("asaas_customer_id").eq("account_id", account.id).single();
  const checkout = [...fake.checkouts].reverse().find((c) => c.externalReference === account.id);
  const ev: BillingEventIn = {
    eventId: q.id,
    asaasEvent: `E2E_${String(q.tipo).toUpperCase()}`,
    kind: q.tipo as BillingEventKind,
    customerId: sub?.asaas_customer_id ?? null,
    subscriptionId: `sub_e2e_${account.code}`,
    paymentId: q.tipo!.startsWith("payment_") ? `pay_e2e_${q.id}` : null,
    valueCents: checkout?.valueCents ?? null,
    dueDate: checkout?.nextDueDate ?? null,
    externalReference: account.id,
  };
  const result = await handleAsaasWebhook(
    billingDeps(),
    { token: process.env.ASAAS_WEBHOOK_TOKEN ?? null, rawBody: JSON.stringify(ev) },
    process.env.ASAAS_WEBHOOK_TOKEN,
    (raw) => raw as BillingEventIn,
  );
  return (
    <main data-outcome={result.outcome} data-status={result.status}>
      {result.outcome}
    </main>
  );
}
