# 06. Integrations

Each integration is an adapter behind an interface in `workers/common` or `apps/web/lib`, so tests replay recorded responses and the provider can change. **No invented responses**: fixtures are recorded from real sandbox or test-environment calls, made in commands Marlon types (D40), and stored in `fixtures/` with secrets and personal data stripped.

## 1. iFood Merchant API (D05, D07, D39, D40)

- **Auth:** OAuth 2.0, centralized app. `POST https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token` with `grantType=client_credentials`, `clientId`, `clientSecret`. Token kept in memory, re-requested on 401 or expiry; no refresh token in this flow. Never store a restaurant password (D39).
- **Environment:** the test app and test store created when Marlon registers as a developer (with his CNPJ, using an e-mail not tied to any Partner Portal account). Test orders are generated in the developer portal to produce data.
- **Modules used:** Merchant (list authorized stores, store details), Financial v3 (Sales, Financial Events, Reconciliation and Reconciliation On Demand as gzipped CSV with `;` delimiter, Settlements, Anticipations). Catalog in V2. Not used: Order, Events, Promotion, Review (D07).
- **First live session (spike, Marlon at the keyboard):**
  1. Token, merchant list, merchant details. Record.
  2. Confirm whether the uuid in the public store URL equals `merchant.id` (D29).
  3. Generate test orders; check what the financial endpoints return for the test store: order level only, or item level (D07). Record every response.
  4. Write the exact endpoint paths and response shapes into `fixtures/ifood/README.md`; the adapter is coded against those recordings.
- **Homologation:** required for the financial module before production; only CNPJ accounts; the form is answered from test-environment calls with header `x-request-homologation: true`. The app must be complete at the meeting. Production app is created after approval, then stores grant permission in the Partner Portal.
- **Schedule:** daily 06:00 São Paulo per authorized store, re-reading 7 days (D31).
- **Revocation:** a 401 or 403 for one store after a valid token means the owner revoked; mark `authorized=false`, raise `data_stale` and an alert.

## 2. iFood portal export files (D08, D45)

- The owner (or a founder with written authorization) downloads the reconciliation and sales reports from the Partner Portal, or the extension does it on the open page.
- Parser in `workers/import/ifood_file.py`, same canonical output as the API adapter (`order_fact`, `order_item_fact`, `ledger_entry`).
- Unknown layout goes to `needs_mapping` (C17).

## 3. 99Food statement (D10)

- Excel statement exported by the owner from the 99Food portal. No public financial API.
- Parser `workers/import/food99_file.py` with `column_mapping`; the payout total in the file must match after mapping.
- Each 99Food store keeps its own link and QR code as `public_url` (D29).

## 4. Asaas (D27)

- **Sandbox first:** `https://api-sandbox.asaas.com`. Production URL after go-live.
- **Customer:** created when the Dono chooses a paid plan (name, CNPJ, e-mail).
- **Checkout:** Asaas hosted checkout with recurring charge (`chargeTypes: RECURRENT`), card only; success and cancel URLs back to `/app/plano`.
- **Trial:** no card at sign-up; when converting during the trial, the subscription's first `nextDueDate` is the trial end date.
- **Webhooks:** `/api/asaas/webhook`, authenticated by the `asaas-access-token` header equal to `ASAAS_WEBHOOK_TOKEN`. Store raw in `billing_event`, dedupe by event id, then update `subscription`. Payment confirmed, overdue, refused and subscription deleted are handled; unknown events are stored and ignored.
- **Pilot charges:** single charges created by a monthly job from `pilot_charge` (D37).
- **Units:** when the number of kitchens in analysis changes, update the subscription value for the next cycle.

## 5. Purchase invoices (D11, D13)

- **XML zip:** parse NF-e (model 55) and NFC-e (model 65): issuer, items, NCM, GTIN, unit, quantity, unit price, access key. Dedupe by access key.
- **Typed key or QR link:** validate the 44-digit key's check digit (mod 11); extract the key from the QR URL `p=` parameter. Item lines typed by a founder from the state's public page in V1.
- **Automatic QR read (SP, PR):** flag `m3.nfce_qr_auto`, off; only the public consumer URL, stop on captcha.
- **No certificate custody**, no SEFAZ Distribuição DF-e client in V1 or V2 (D12).

## 6. AI API (D14, D70)

- **Provider (D70, Marlon 08/nov):** OpenAI (Responses API, strict JSON schema), default model `gpt-6.1-sol`. One
  module, `margo_common.llm`, knows the provider: `MARGO_AI_PROVIDER=openai|anthropic`, the key by name
  (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`), the model per use (`MARGO_MATCH_MODEL`, `MARGO_PAIR_MODEL`,
  `MARGO_OPPORTUNITIES_MODEL`). A benchmark may change the provider later without touching the uses.
- **Uses:** `worker-match` (below); M1-04 Stage 2 attributes and P23 "Oportunidades" in `worker-collector`. Each use
  validates every answer; the provider never decides what is stored.
- `worker-match` suggests an ingredient for an invoice line the rules did not match.
- Sends supplier name, item description, unit and price. No personal data, no CNPJ of the restaurant.
- Output is a suggestion with a confidence; it never enters a cost until a founder confirms (C11).
- Key in Maritime env only.

## 7. E-mail and WhatsApp (D36)

- **Interface:** `Notifier.send(notification)` in `apps/web/lib/notifier`.
- **Dev provider:** writes to the `notification` table and a local inbox page `/dev/inbox` (local env only).
- **E-mail provider:** open (Amazon SES, Resend or Postmark). Sender `avisos@margoai.com`, domain to be confirmed; SPF, DKIM and DMARC set before go-live.
- **WhatsApp:** manual until the WhatsApp Business Platform with approved templates. Manual means the console shows a queue of ready messages with a click-to-chat link for the founder on duty. Login codes by WhatsApp therefore need the platform; until then, login codes go by e-mail and the WhatsApp option on P15 is hidden by the flag `auth.whatsapp_code` (off).

## 8. Maritime (D42)

- One Maritime agent per worker type and environment: `worker-import`, `worker-collector`, `worker-match`, `worker-render`, each a container built from `workers/<type>/Dockerfile`.
- **Wake by webhook:** `POST https://api.maritime.sh/api/webhooks/{agent_id}` with `{job_id, ts, sig}`; the worker verifies the HMAC before reading the job.
- **Schedules:** Maritime cron triggers (five-field cron) deliver a scheduled message; the worker turns it into jobs (for example, one import job per authorized store at 06:00 São Paulo).
- **Env:** encrypted environment variables per agent (Supabase service key, iFood credentials for import, AI key for match and collector, signing key).
- **Persistence:** none relied on; `/data` is scratch and is wiped after each job.
- **Timers inside a sleeping agent do not fire**, so no in-process schedulers; only platform triggers.
- **Health:** each worker exposes a health response to a signed `ping` job; Vercel Cron pings hourly.

## 9. Chrome extension (D01a, D32)

- Manifest V3, TypeScript, unlisted listing in the Chrome Web Store.
- Host permissions: the iFood Partner Portal domain and our API domain only.
- Pairing: the owner clicks "Adicionar ao Chrome" from W07 while logged in; the portal issues an `extension_token` shown once and passed to the extension through a one-time pairing page.
- Action: on the open portal page, click Export for the requested report and period, capture the download, upload to `/api/ext/upload`. Never reads credentials, never navigates on its own beyond the report page the owner opened.
- The legal consult (D01b) covers the extension against iFood's terms before it is offered to owners outside the test case.

## 10. External extractor (D47b, D47c)

- **Contract:** `docs/extract-api.md`, the only one, for any source. The first is `margoai-menu-scraper`, owned and run by Marlon. It only extracts; all logic lives in MargoAI. It holds `MARGO_EXTRACT_TOKEN` and no database credential.
- **Queue:** `extract_discover` and `extract_capture` rows of `job`, claimed with `POST /api/extract/claim`, up to `m1.extract_max_running` at once, the server decides (02 §4). Flag `m1.extracao`.
- **Retry:** one attempt per claim; the extractor reports it with `POST /api/extract/fail` and a reason (`blocked`, `timeout`, `network`, `not_found`, `parse_error`, `other`). MargoAI retries the transitory ones as the same job after `not_before`, up to `m1.extract_max_attempts` (04 §1). The extractor keeps its circuit breaker for a general block.
- **Pipeline:** C02 creates the `collect` job, which queues `extract_discover` for the target. The result is written as copies and applied by `app.apply_extract_copy`, in the database, then queues `xray_neighborhood` (M1-01, M1-02) in worker-collector. That job ranks the set (M1-11) and queues `extract_capture` for the target and the top `m1.extract_max_captures_per_xray` stores; when the last capture ends, the neighborhood runs again with the item taxonomies.
- **Refresh:** Vercel Cron `/api/cron/extract`, daily, per `m1.extract_every_days`.
- **What is kept:** allowlisted structured fields only, as dated copies that are never rewritten (D47c). No raw HTML, no customer reviews. The street address goes to `public_store_private` only.
- **Not sent by the extractor today:** a signal for "delivers to the target's neighborhood". The C02 toggle stays without effect until one exists.
- The legal consult (D01b) still comes before the first X-ray delivered outside the test case.
