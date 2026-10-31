// Asaas webhooks (06 §4, D27): `asaas-access-token` must equal ASAAS_WEBHOOK_TOKEN; raw events go to
// billing_event, deduped by event id, then the subscription is updated (lib/billing/webhook.ts).
import { NextResponse, type NextRequest } from "next/server";
import { billingDeps } from "@/lib/billing/deps";
import { handleAsaasWebhook } from "@/lib/billing/webhook";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await handleAsaasWebhook(
    billingDeps(),
    { token: req.headers.get("asaas-access-token"), rawBody: await req.text() },
    process.env.ASAAS_WEBHOOK_TOKEN,
  );
  // 02 §8: outcome only, never the body.
  console.info(JSON.stringify({ service: "asaas_webhook", status: result.status, outcome: result.outcome }));
  return NextResponse.json({ ok: result.status === 200 }, { status: result.status });
}
