# Asaas recordings (06 §4, D40)

Tests never use an invented Asaas body. Everything in this folder is recorded from the **Asaas sandbox**
(`https://api-sandbox.asaas.com`) by commands Marlon types, with personal data replaced by `REDACTED`
(names, e-mails, phones, documents, addresses, card data, IPs, URLs). Build agents never call Asaas.

Until the files exist, `apps/web/lib/billing/asaas-parse.test.ts` is skipped. When they land, it runs
on its own: every `webhooks/<EVENT>.json` must parse to the internal event the name implies.

## What to record

| File | How |
|---|---|
| `api/customers.create.json`, `api/checkouts.create.json` | step 1 |
| `webhooks/SUBSCRIPTION_CREATED.json`, `webhooks/PAYMENT_CREATED.json`, `webhooks/PAYMENT_CONFIRMED.json` (and `PAYMENT_RECEIVED` if sent) | steps 2 and 3 |
| `webhooks/PAYMENT_CREDIT_CARD_CAPTURE_REFUSED.json` | step 2 with the sandbox's refused test card |
| `webhooks/PAYMENT_OVERDUE.json` | a sandbox payment left unpaid past its due date |
| `webhooks/SUBSCRIPTION_DELETED.json` | delete the sandbox subscription in the Asaas panel |
| `api/payments.create.json` (pilot charge), `api/subscriptions.update.json` (units change) | step 4 |

## Commands

From the repository root. The key goes only into the command line, never into a file.

1. API calls (synthetic customer with a random CNPJ, recurring card checkout):

   ```sh
   ASAAS_API_KEY='<sandbox key>' node scripts/record_asaas.mjs api
   ```

   It prints the checkout link. Open it and pay with an Asaas sandbox test card.

2. Webhooks. In the Asaas sandbox panel, point the webhook at the Vercel preview,
   `https://<preview>/api/asaas/webhook`, with the same token as the preview's `ASAAS_WEBHOOK_TOKEN`.
   The preview stores every raw event in `billing_event` of the **dev** Supabase project. Pay once with
   the approved test card and once with the refused one, then delete the subscription.

3. Export the raw events from the dev project (SQL editor in the Supabase dashboard) and save the result
   as a JSON array in a file outside the repository, e.g. `~/asaas-events.json`:

   ```sql
   select json_agg(payload order by received_at) from billing_event;
   ```

   Then sanitize them into this folder:

   ```sh
   node scripts/record_asaas.mjs webhooks ~/asaas-events.json
   ```

4. Optional, for the pilot charge and the units update:

   ```sh
   ASAAS_API_KEY='<sandbox key>' node scripts/record_asaas.mjs payment <cus_id from step 1>
   ASAAS_API_KEY='<sandbox key>' node scripts/record_asaas.mjs update-value <sub_id from step 2> 600
   ```

5. Read the files before committing (`git diff fixtures/asaas`), run `uv run python scripts/secret_scan.py`,
   then `pnpm --filter @margoai/web test`. If a field our parser reads has another name in the recording,
   the parser test fails and `apps/web/lib/billing/asaas-parse.ts` is fixed against the recording.

## E01 on the preview (07 §2, Marlon)

Sign up a new account on the preview (trial), open Plano e cobrança, "Assinar pelo Asaas", pay with the
approved test card, and check that the subscription turns `ativa` in C15 once the webhook arrives. Replay
the same webhook from the Asaas panel: C15 and `billing_event` must not change.
