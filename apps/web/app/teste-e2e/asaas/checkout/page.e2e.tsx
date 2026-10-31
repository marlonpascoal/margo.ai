// TEST ONLY: stands in for the Asaas hosted checkout (P10, not built by us) in e2e/billing.e2e.ts. Shows
// what our code asked the fake client for and returns to the success or cancel URL, like Asaas does.
// Compiled only when MARGO_E2E_ROUTES=1 (next.config.ts); 404 outside the local stack.
import Link from "next/link";
import { notFound } from "next/navigation";
import { brlCents } from "@/lib/m2/format";
import { e2eAsaas, e2eOnly } from "../fake.e2e";

export const dynamic = "force-dynamic";

export default async function FakeCheckout({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (!e2eOnly()) notFound();
  const { id } = await searchParams;
  const c = e2eAsaas().checkouts.find((x) => x.id === id);
  if (!c) notFound();
  return (
    <main className="flex flex-col gap-2 p-6 font-sans" data-checkout={c.id}>
      <h1 className="m-0 text-2xl">Checkout do Asaas (simulado no e2e)</h1>
      <div data-field="item">{c.itemName}</div>
      <div data-field="value">{brlCents(c.valueCents)}</div>
      <div data-field="description">{c.itemDescription}</div>
      <div data-field="next-due">{c.nextDueDate}</div>
      <Link href={new URL(c.successUrl).pathname + new URL(c.successUrl).search}>Assinar</Link>
      <Link href={new URL(c.cancelUrl).pathname + new URL(c.cancelUrl).search}>Voltar e trocar de plano</Link>
    </main>
  );
}
