---
title: "MargoAI build: decisions to close before writing the spec"
date: 2026-10-30
status: closed 30/out; section 1 overrides everything below; D41 to D48 set hosting (Vercel, Supabase, Maritime), build order and legal; spec written in margoai-spec/
inputs: playbook "from course assignment to a self-running agentic MVP"; margoai-experimentos.md (17/out); margem-coleta-de-custo.md; margoai-infra-visao-e-plano.md (v2); margoai-estrategia-compass-stern.md; margoai-lp/index.html
---

# MargoAI build: decisions to close before writing the spec

The playbook tells us to agree on three things before writing files: the capability list, the rules table and the acceptance table. This document goes one step earlier and puts on the table every decision that changes what those three look like. Each item has options, a recommendation and what it blocks.

**Tags**
- **[BLOCKING]**: I cannot write the spec without your answer.
- **[DEFAULT]**: I will follow the recommendation unless you object.
- **[LATER]**: recorded so it is not forgotten; does not block V1.

---

## 1. Closed on 30/out (voice discussion with Marlon)

This section overrides anything below that contradicts it. The original analysis is kept underneath because it explains the options.

| # | Decision | What was decided |
|---|---|---|
| D01 | Scope and order | **Staged, in three modules, in this order.** **Module 1: price X-ray from public data** (menu prices, comparison with competitors nearby). **Module 2: iFood data with the restaurant's authorization**, tested in the iFood test environment first, then with real restaurants. **Module 3: purchase invoices (NF-e and NFC-e)**, after checking what credentials each route needs and whether a test environment exists |
| D01a | How module 2 gets data | In order of preference: (1) **official iFood API**, the owner authorizes our app; (2) **a Chrome extension** that runs in the owner's own browser, where the owner is already logged in, and reads or exports what the API does not give; we never hold the password; (3) **file exports** the owner downloads and sends. Not done: a browser agent logged in with the restaurant's password |
| D01b | Legal consult | Agreed. Scope: collecting public data at scale (module 1), the Chrome extension against iFood's terms (module 2), custody of digital certificates (module 3) |
| D02 | How the build runs and how you watch it | **Claude Code inside VS Code on the Mac mini** (Claude Code extension): Claude panel on one side, file explorer showing files as they are created, a diff for every change. Runs without asking for approvals, through a permissions file (edits auto-accepted, build commands allowed, risky ones blocked: reading secrets, running the secrets manager, `git push`). Watched live from the laptop by screen sharing or a VS Code remote tunnel. **Not** a shell script running headless in a terminal |
| D03 | Test case for module 1 | **Pantanos Burguer, Igapó, Londrina** (`ifood.com.br/delivery/londrina-pr/pantanos-burguer-igapo/91a9c35d-...`). Fresh run, no exact target to reproduce: the raw data and scripts of the August Espeto Burguer run are not available, and prices have changed. The August summary (107 stores, 646 items, 8 of 29 items carrying 80% of the loss) is only a sanity check on orders of magnitude |
| D03a | What module 1 standardizes now | Generic already: search stores within 3 km, match comparable items, compute a parity price per item, rank gaps (Pareto), fixed report with "three prices you can raise today". Was hand-tuned and must become rules: **which stores count as competitors** and **unit normalization** (items sold by weight or in packs). Out of module 1: the propensity (logit) model, added later |
| D06 | CNPJ for the iFood developer app | Marlon has a CNPJ available if needed. Not needed for module 1. **First check of module 2:** does the developer account or the test environment already require a CNPJ? If yes, use his |
| D09 | Secrets | **No secrets in `.env` files.** An application secrets manager injects secrets into the MargoAI process at run time; build agents are blocked from running its command line. **Closed by D44:** platform encrypted environment variables (Vercel, Maritime, Supabase), no separate tool |
| D10 | POS integration | Not now. Module 1 is public data and module 2 takes sales from the iFood API |
| D14 | Claude API for ingredient mapping (module 3) | Agreed. Sends supplier, item and price, no personal data; a founder confirms each match |
| D20 | Build agents and real data | Agreed: build agents never read real restaurant data, only synthetic or anonymized data |
| Design | Interface | **No generic interface, and not the one Claude uses.** A gallery of 12 directions exists; the choice is deferred by D40: the build uses neutral design tokens and the chosen direction later replaces the tokens, not the screens |

### 1.1 Decided on 30/out evening, while drawing the screens

Screens: canvas "MargoAI: todas as telas" (https://claude.ai/artifact/AYwbRTZyGH2bUQ6LSwH8ve), neutral wireframe style, 53 screens plus the map. Visual direction still to be chosen from the 12 in the gallery.

| # | Decision | What was decided |
|---|---|---|
| D27 | Billing | **Asaas**, card only. The owner creates an account, gets a free trial with no card, then chooses a plan. Payment happens on the Asaas hosted checkout (recurring), so card data never touches MargoAI. Subscription status comes from Asaas webhooks. Test in the Asaas sandbox first |
| D28 | Owner account | The owner now has a MargoAI account (sign-up, my account, plan, terms, people). This replaces the earlier assumption that the owner never logs in before 15/fev. **Open:** trial length (shown as 14 days, placeholder) and plan prices (shown as Raio-X free, Lucro R$ 300 per store per month from the ad-test page, Rede by conversation) |
| D29 | Entity model | Mirrors iFood: **Conta** (group, who pays) → **Empresa** (CNPJ; invoices attach here) → **Unidade** (physical kitchen, one address, can host several brands) → **Loja de canal** (one brand at one kitchen on one app; equals the iFood merchant, `id` UUID, `name`, `corporateName`). **Pessoas** with profiles copied from iFood (owner, finance, kitchen manager) scoped to some or all kitchens. New iFood stores arrive "sem cozinha" until linked. **Every channel store keeps its public URL and the app's own id, on every platform**: on iFood the URL is `ifood.com.br/delivery/{cidade-uf}/{slug}/{uuid}`, and the uuid at the end identifies the store in iFood's public catalog; 99Food gives each store an exclusive link and QR code. If the iFood uuid in the URL equals the `merchant.id` of the official API (likely, to confirm in the module 2 spike), the public X-ray store and the authorized store link themselves. A channel store can exist without the owner's consent (Keeta's "compra intermediada" lists restaurants without a contract), so "listed on the app" and "authorized by the owner" are separate states. **Open:** charge per kitchen (proposed) or per channel store; how one iFood login reaches several stores (check in the module 2 spike) |
| D30 | Contestations | The owner files each claim in the iFood portal (we do not automate sessions). Statuses: a contestar, contestada (em análise), creditada, negada, prazo vencido, plus "precisa da sua resposta" for probable items. The owner marks contested (with protocol) and denied; **MargoAI marks credited** when the money shows in the settlement; expired is automatic. Shared between owner (P12) and console (C16) |
| D31 | Imports | Recurring and in the background, never a one-time upload. iFood API on a daily schedule re-reading the last 7 days; extension sends daily when the owner opens the portal; files enter the same queue from upload, the BPO folder or WhatsApp. **Full history of every import** (when, trigger, channel, stores, period, rows, duration, status, log, rerun). Rows repeated across imports count once. Failures alert the founders |
| D32 | Owner on desktop | The owner portal is a responsive web app: the same pages on phone (P screens) and computer (W01 to W07, top menu). WhatsApp screens are phone only; **the Chrome extension is computer only** (on the phone, the owner asks for the link to open on the computer); PDFs stay A4 |
| D33 | Multiple users, simple permissions | Owner side: three profiles. **Dono** (everything, including plan, billing and people), **Financeiro** (close, contestations, invoices, all kitchens), **Gerente de cozinha** (only their kitchen, no billing). Each person sees all kitchens or chosen ones. Every account keeps at least one Dono; only the Dono invites, changes profiles and removes people; every action is logged with who did it. Console side: two roles, **Fundador** (everything) and **Operação** (no billing, secrets or feature toggles) |
| D34 | Feature toggles | Every product feature has a flag key (for example `m2.ifood_api`, `m3.nfce_qr_auto`, `l.painel_dono`). The plan sets the default; an account can have an exception; separate values for sandbox and production; every change logged. Screens marked "after 15/fev" are flags off. Implementation: flags in our own database behind the OpenFeature standard, so a service such as Unleash or GrowthBook can replace it later without rewriting. Managed in C20, Fundador only |
| D35 | Login and access recovery | **Passwordless everywhere.** Owner side: a 6-digit code by WhatsApp or e-mail, valid 10 minutes (P15, W06); computer sessions last 30 days; "sign out of all devices" and device list (W09). No password to recover: recovery means switching channel, changing number or e-mail with a code on the new channel and a notice to the old one, a 24-hour lock on plan and people changes after a change, re-invite by another Dono, or, for a sole Dono who lost both channels, verification by the MargoAI team against the CNPJ and articles of association (P17). Invites by WhatsApp or e-mail, valid 7 days (P18). Console: e-mail plus code, invited e-mails only, 12-hour session, every action logged (C00). **This supersedes D17's "console local, no login"**, which no longer works once there are roles (D33) |
| D36 | Notifications | **E-mail and WhatsApp.** Each person picks per notice and per channel (P16, W08). Billing and security notices always go by e-mail. Quiet hours: no WhatsApp from 22h to 8h. Team alerts in C21, by e-mail to the team, urgent ones also by WhatsApp to the founder on duty. Sender `avisos@margoai.com` (domain still to be checked, see naming notes). **Open:** e-mail provider (candidates: Amazon SES, Resend, Postmark); automated WhatsApp needs the WhatsApp Business Platform with approved templates, so D24 moves earlier, or WhatsApp stays manual until then and e-mail carries the automatic notices |
| D37 | Paid pilot | Kept alongside the plans until 15/fev, configured per account in C15: months 1 and 2 charge a percentage of the credited amount (separate Asaas charges, computed from C16), with a monthly cap; from day 61 a fixed monthly subscription per kitchen, no last-minute discount (test E6). Values still to be closed with Manuel |
| D38 | Entry point | The ad-test landing page is the first card on the map; its lead goes to a new X-ray (C02) |
| D39 | iFood authorization is OAuth 2.0 | **We never store a restaurant's password.** The owner grants our app in the Partner Portal; iFood then gives our app a Bearer token. What we keep: our own app's `clientId` and `clientSecret` in the secrets manager (D09), and short-lived tokens in memory. In the centralized flow there is no refresh token: the app asks for a new token when one expires or when a store adds a new permission. Revocation is in the owner's hands, in the Partner Portal |
| D40 | Open items do not block the build | Agreed 30/out: the spec and the build go ahead now, and every open item becomes **configuration or an adapter with a stand-in**, decided before go-live, not before coding. (1) Secrets: closed by D44 (platform environment variables). (2) iFood: **no fake API** (Marlon, 30/out). Module 2 is built against iFood's own test environment: registering as a developer gives a test store and a test app with real credentials, test orders can be generated, and the financial homologation itself is answered from test-environment data (header `x-request-homologation: true`). Marlon registers now with his CNPJ, using an e-mail not tied to any Partner Portal account. Live calls run only in commands Marlon types (secrets injected; build agents never get them); unit tests replay responses recorded from those real test calls, never invented ones. First check: whether the test store produces financial data (sales, reconciliation) or only orders. (3) Trial and prices: rows in the plans table, edited in C15, placeholders 14 days and the ad-test prices. (4) Per kitchen or per store: the billing unit is a plan field (`unidade_cobranca`), so changing it is data, not code. (5) Visual: screens are built on design tokens (color, type, spacing, radius) with a neutral theme; the chosen direction later replaces the tokens, not the screens. (6) E-mail and WhatsApp: a `Notifier` interface; in development it writes messages to a log and a local inbox; WhatsApp stays manual (click-to-chat link) until the Business Platform. (7) Pilot: percentage and cap are per-account fields in C15 |

### 1.2 Decided on 30/out night: deploy, agents and the remaining gaps

| # | Decision | What was decided |
|---|---|---|
| D41 | Hosting | **Deployed, not local.** Web app (owner portal, founders' console, API routes, Asaas webhooks, scheduled triggers) on **Vercel**, functions in the São Paulo region. **Supabase** for Postgres, login codes, file storage and row-level security, project in São Paulo (`sa-east-1`). Two Supabase projects: **dev** (synthetic data only, the only one build agents touch) and **prod** (real data; only Marlon and Manuel hold its keys). The Mac mini is the build machine, nothing runs there in production. "For a while": if Vercel or Supabase stop fitting, the database is plain Postgres and the app is plain Next.js, so moving is a migration, not a rewrite. Supersedes D19's SQLite and local page, D25 and D20's `~/MargoData` folder |
| D42 | Agents and workers on Maritime | **Maritime** (maritime.sh) runs the product's agents and background workers, the work that does not fit a short Vercel function: the import workers (iFood API pulls, file parsing), the module 1 collector of public menu pages (can use a real Chrome), ingredient matching with the Claude API, PDF rendering, and after 15/fev the owner-facing agents (L01, L02, MCP). Each worker is a Docker container (one Maritime agent per job type, not per client). Woken two ways: Maritime cron triggers for schedules (daily import at 06:00 São Paulo) and Maritime webhooks called by our app when a job is queued. The webhook URL is the only credential Maritime asks for, so every call also carries our own HMAC signature and the worker rejects unsigned calls. Workers are stateless: they read the job from a Supabase queue table, write results to Supabase, keep files in Supabase Storage, and wipe their `/data` volume after each job. Build agents stay Claude Code on the Mac mini (D02); Maritime is runtime, not the build. **Risks accepted:** Maritime runs in the United States or Germany only (no Brazil region), so restaurant data is processed abroad: covered by the international transfer clause in the owner terms (D48) and Maritime's data processing agreement; Maritime is new (YC F26, SOC 2 still underway), so every worker sits behind a `Runner` interface and can move to another container host without touching job code |
| D43 | Stack | **Web:** TypeScript, Next.js (App Router), Supabase client, Tailwind with the design tokens of D40, Playwright for end-to-end tests. **Workers:** Python 3.12 with `uv` (strong CSV, Excel and XML libraries: `polars`, `openpyxl`, `lxml`, `httpx`, `weasyprint`, Playwright), packaged as containers. **Extension:** Chrome Manifest V3 in TypeScript, unlisted in the Chrome Web Store. **The database schema is the contract** between the two languages: SQL migrations with the Supabase CLI, generated TypeScript types, Pydantic models for Python. Money in integer centavos, business dates in `America/Sao_Paulo`. Supersedes D19 |
| D44 | Secrets | **No separate secrets manager.** Secrets live in the platforms' encrypted environment variables: Vercel (web), Maritime (workers), Supabase (database keys). Nothing in the repository, no `.env` file with a real value anywhere. Local development uses the Supabase local stack, whose keys are fixed public defaults, not secrets. Sandbox keys (Asaas sandbox, iFood test app) exist only in the **preview** environment of Vercel and in the dev workers on Maritime; live calls to those sandboxes run in preview deploys or in commands Marlon types. Build agents are denied: `vercel env`, `maritime` secrets commands, `supabase link` to prod, reading any `.env*`, `git push`. Closes open item 1 and supersedes D09's "tool still open" and the old D09 note below |
| D45 | Build order against 16/nov | Wave 0 builds the shared base. Then **two lanes in parallel**: lane A, module 1 (price X-ray); lane B, module 2 **starting with file imports** (iFood reconciliation file exported from the portal, 99Food Excel statement), so the E4 deliveries starting 16/nov have a tool; the iFood API adapter joins lane B as soon as the developer account exists. Module 3 in V1 is the accountant's XML zip plus keys and QR links typed by a founder. Owner portal and Asaas in wave 2. Until lane B is ready, E4 runs by hand. **To confirm with Manuel**, but the build starts on this order |
| D46 | Acceptance data and first formats | A synthetic group `G-SYN` (the fictitious numbers of the canvas, labeled `SINTÉTICO` in every output) is the first acceptance case. **V1 is not "done" until it reproduces one real hand-calculated E1 and E2 case**, anonymized before it reaches the repository. First sales-by-item import: a generic CSV template; a specific POS adapter only when the first group's POS is known |
| D47 | How module 1 collects public prices | Only public iFood store pages, no login, a user agent that names MargoAI with a contact address, at most one request every 3 seconds, one collector at a time, raw pages cached 7 days, the run stops on any captcha or block (no circumvention, ever). Stored: store name, id, URL, address area, menu items, prices, units; no personal data. Test runs (Pantanos Burguer and the G-SYN neighborhood) are allowed now; **the legal consult (D01b) comes before the first X-ray delivered to a restaurant outside the test case** |
| D48 | LGPD and terms | The spec ships drafts in `docs/legal/`: owner data authorization per CNPJ (which data, purpose, AI processing, international transfer to the hosts in the United States and Germany, retention, deletion), privacy policy and terms of use. A lawyer reads them before the first real file. Deletion within 90 days after a request or after a client leaves, as P11 and W09 already promise. Supersedes D21's "draft later" |

**Still open, decided before go-live, not blocking the build (D40):** (1) whether iFood's developer registration requires a CNPJ (Marlon registers with his and finds out); (2) trial length and plan prices; (3) charge per kitchen or per channel store; (4) visual direction; (5) e-mail provider and when to adopt the WhatsApp Business Platform; (6) pilot percentage and cap. Closed since the last version: secrets (D44), hosting (D41), build order (D45, pending Manuel's yes).

**Consequence to watch (now handled by D45).** The experiment plan of 17/out needs, by 16/nov, a tool that reads statements and purchase XMLs (V1, for E1, E2 and E4). With the new order, statements arrive in module 2 and invoices in module 3. Either module 2 starts with file imports so E4 is not delayed, or E4 runs by hand while module 1 is built. Worth deciding with Manuel.

---

> **Read this first.** Everything from here down is the original analysis of 30/out morning. Where it disagrees with section 1 (D01 to D48), section 1 wins. Known superseded items: D02 option C (closed as all live in VS Code), D06 recommendation 3 (the iFood test environment is used from day one, D40), D09 below (`.env`, replaced by D44), D17 (console now has login, D35; surfaces are the deployed web app, D41), D18 (visual direction deferred, D40), D19 (stack and hosting, D41 to D43), D20 item 1 (`~/MargoData`, replaced by the prod Supabase project, D41), D21 (drafts now in the spec, D48), D25 (portal is in scope now, D41).

## 0. What is different from the Agent Trust Layer build

| Topic | Agent Trust Layer (HW6) | MargoAI |
|---|---|---|
| Who defines "done" | Course rubric, line by line | Our own experiment plan: the V1 "ready" criteria and the hand-calculated results of E1 and E2 |
| External system | Asaas sandbox, open to anyone | iFood requires an app, a CNPJ account and a homologation meeting for the financial module. 99Food has no public financial API |
| Data | Fake money in a sandbox | Real restaurant data (sales, fees, purchase invoices). Confidential and subject to LGPD |
| Who uses the product | An AI agent through MCP | The two founders, running a concierge service. Agents and API are frozen until 15/fev/2027 |
| How it runs | Overnight, unattended | You want to watch the process (decision D02) |
| Deadline | Course due date | E4 first deliveries start 16/nov. V1 must be usable by then: about two and a half weeks from today |

The last line is the constraint that matters most. Everything below is biased toward having V1 working on 16/nov.

---

## A. Scope and process

### D01. What "the whole product" means for this build [BLOCKING]

The experiment plan (17/out) already defines product versions and freezes API, MCP and agents until 15/fev.

| Option | What gets specified | What gets built now |
|---|---|---|
| **A. Staged (recommended)** | Everything: V1, V2, V2b in full detail; V3 (client portal, approval flow, agent API/MCP) as design-only spec: data model, interfaces, screens | V1 by 16/nov, then V2 and V2b in Dec and Jan |
| B. Full build | Everything | Everything, including client portal and MCP |
| C. V1 only | V1 | V1 |

**Recommendation: A.** You get the full product specified, so the data model and module boundaries are right from day one, but the build order follows the experiments. Option B contradicts the freeze we wrote on 17/out and burns weeks on screens nobody uses before E4 says the number changes a decision. If you want B, we should first change the experiment plan, not just the spec.

| Version | Serves | Ready when |
|---|---|---|
| V1. Concierge tool | E1, E2, E4, E5, E7 | Reads iFood and 99Food statements and a purchase XML folder for a new group; reproduces the hand-calculated E1 and E2 results; generates the E4 deliverable in a fixed format; logs hours per step |
| V2. Recurring close | E6, E7 | Month 2 of a group takes half the hours of month 1; mapping from month 1 reused; no founder redoing math by hand |
| V2b. BPO delivery | E8 | Same output with the BPO's brand; BPO drops files in a shared folder without us in the middle |
| V3. Product (design only) | After 15/fev | Client portal, coupon approval flow, contribution API, MCP |

### D02. How you watch the build [BLOCKING]

| Option | How it looks |
|---|---|
| A. Overnight unattended (playbook as is) | Supervisor runs sessions; you read `MORNING.md` and `status.sh` |
| B. All live | Every session interactive in Claude Code on the Mac mini; you watch over screen sharing |
| **C. Hybrid (recommended)** | Live and interactive for Wave 0, the iFood spike and every merge to main. Unattended for the parallel build lanes. A live log pane always on (`tail -f` of the session stream through `jq`), plus `status.sh` |

**Recommendation: C.** The risky parts (contracts, iFood auth, data model) are where you want to see and steer. The lane work is test-driven and boring to watch. Question for you: when you say "see the whole process", do you mean watching it live, or being able to inspect every step afterwards? If the second, A plus a richer log is enough.

### D03. Where acceptance comes from [BLOCKING, depends on your answer about E1 and E2]

There is no rubric, so the acceptance table maps to the V1 "ready" criteria above. The strongest acceptance test we can have is a **golden case**: a real group's numbers calculated by hand in E1 (repasse) and E2 (cost coverage), which V1 must reproduce exactly.

Question: E1 (M2a) and E2 were due 31/out. Do we have the hand-calculated results for at least one group?
- **If yes:** they become the golden fixtures, anonymized (see D20).
- **If not yet:** I build a synthetic group with realistic values, labeled `SYNTHETIC` in every output, and V1 is accepted against it first and against the real case when it arrives. V1 cannot be called done until it matches one real case.

### D04. Languages [DEFAULT]

Specs, code and agent instructions in English (agents read them better, and it matches the playbook). Runbook (`RUN.md`) and everything the restaurant sees (deliverable, labels, messages) in Brazilian Portuguese.

---

## B. iFood

### D05. App type: centralized or distributed [DEFAULT, confirm in the spike]

iFood offers two authorization models. In the centralized one, the app holds its own `clientId` and `clientSecret` on a server, gets a token with `client_credentials`, and receives no refresh token. The store owner grants permission to the app in the Partner Portal ("Meus Aplicativos"), and the app must request a new token after each new permission. In the distributed one, each installation generates a link code (`userCode`), the owner authorizes it in the portal and types an authorization code back into the app, which then gets an access token plus a refresh token.

**Recommendation: centralized.** Our software is one instance (the Mac mini, later a server) reading all client stores; that is exactly the centralized case, and it avoids code-typing steps with each owner. Note that the owner must log in with the store owner profile ("Gestor") to see the "Permitir" button; worth putting in the onboarding script.

### D06. Which account and which CNPJ register the app [BLOCKING]

iFood's financial module requires every integrator to pass a homologation, and it does not accept homologation requests from personal or student (CPF) accounts, only professional (CNPJ) accounts. The homologation also tests the app as a whole, so it has to be ready before the meeting.

Options:
1. Register under an existing CNPJ (Arbo, for example) now, move to a MargoAI entity later.
2. Open a MargoAI entity first (weeks, and it is a one-way door we listed as "wait until 15/fev" only for fundraising, not for incorporation).
3. Do not use the API in V1 at all; use the files the owner exports from the portal (D08).

**Recommendation: 3 for V1, and start 1 in parallel.** Create the developer account now so we can use the test environment and run the spike, but do not depend on homologation for E4. Who owns the developer account matters later: when the iFood sees which apps request the financial module and how many stores authorized them, the app name and the CNPJ are what they see. Your call, and probably a conversation with Manuel.

### D07. Which iFood data we pull [DEFAULT]

Minimum scope, as the v2 plan says ("ask for the minimum scope"). The current financial module (v3) has: Sales (sales per order), Financial Events (every credit and debit of the settlement period, with expected payment dates), Reconciliation (same purpose, as CSV), Reconciliation On Demand (CSV generated on request), Settlements (net amount paid and receivables sent to financial institutions) and Anticipations (which payments were advanced).

| Module | Use | V1 |
|---|---|---|
| Merchant | List the stores the owner authorized | Yes |
| Financial: Reconciliation On Demand (CSV) | Main source: one file per store and period, every line with its type (financial entry, retention, subsidy, refund) | Yes, as the primary API source |
| Financial: Settlements, Anticipations | Check the money that actually arrived; explains gaps caused by advance payments | Yes |
| Financial: Financial Events | Same data as the CSV, in JSON; useful for incremental sync | V2 |
| Catalog | Menu items and prices per store | V2, for contribution per item |
| Order, Events, Promotion, Review | Not needed; Order would make us a POS integrator | No |

Open point to close in the spike: whether the financial data reaches **item level** or stops at order level. Contribution per item needs the item mix. If the API stops at order level, the item mix comes from the portal's sales report or the POS export (D10).

### D08. iFood data without the API: portal exports [DEFAULT]

Rule already in the August plan: the logged-in portal is used only to **export reports**, never to automate a session. V1 imports the reconciliation and sales files that the owner (or Manuel, with the owner's written authorization) downloads from the Partner Portal. The API is a second adapter behind the same interface, switched on after homologation. Both adapters produce the same canonical records, so nothing downstream changes.

### D09. Where the iFood secret lives [DEFAULT]

**Superseded by D44** (no `.env`). Kept from this item: build agents are denied any secret; tokens stay in memory and are re-requested on 401; every external call logged as one JSONL line with secrets redacted.

---

## C. Other channels and the item mix

### D10. 99Food, Keeta and the item mix [DEFAULT]

- **99Food:** no public financial API found. The portal offers a financial statement in Excel, which 99Food itself documents for partners. V1 imports that file. 99Food and Keeta joined Open Delivery, but that standard covers orders, not settlement.
- **Keeta and Rappi:** out of V1. In the ICP sample, iFood plus 99Food is the multichannel case that matters.
- **Item mix per channel:** from the POS export or the portal sales-by-item report, imported as a file. V1 supports one POS export format (the one the first E4 group uses) plus a generic CSV template.

Question for you: which POS do the first E4 groups use? It decides the first import format.

---

## D. Purchase cost: NF-e and NFC-e

The method is already decided (margem-coleta-de-custo.md): price comes from sampling invoices, quantity from the recipe built by us in onboarding. What remains are engineering decisions.

### D11. V1 cost source: the accountant's XML folder [DEFAULT]

The client (or their accountant) sends a zip with 12 months of purchase XMLs. V1 parses NF-e (model 55) and NFC-e (model 65) XMLs, deduplicates by access key, and extracts supplier, item description, NCM, GTIN when present, unit, quantity and unit price. No credential involved.

### D12. Keeping cost alive after month 1 [BLOCKING for V2, not for V1]

| Option | How | Cost and risk |
|---|---|---|
| a. Ask the accountant monthly | Same zip, every month | Zero tech; depends on the accountant's goodwill |
| b. Our own Distribuição DF-e client | We hold the client's A1 certificate and query SEFAZ | Returns only a summary unless we post the recipient's acknowledgment with the client's certificate; documents available for 90 days; 20 queries per hour, sequential. We would be custodians of a certificate that signs on the client's behalf |
| c. Third-party inbound API (NFe.io, Focus NFe, Qive, SIEG) | Client uploads the A1 to the provider; we receive XMLs by webhook | The provider still needs the client's A1 certificate, so the custody question moves, it does not disappear; monthly fee per CNPJ |
| d. Use what the client already has | Many groups already use Qive or SIEG; we read their export | Zero custody; depends on the client |

**Recommendation: a and d in V2; c only after the legal opinion on certificate custody** (question 5 of the cost document, still open). Not b: building and operating a SEFAZ client with certificate custody is the wrong use of two founders' time before 15/fev. One fact that matters if we ever do it: since 1/jun/2026, the deadline for the recipient's conclusive acknowledgment of an NF-e was cut from 180 to 90 days.

### D13. Receipt photos (NFC-e QR code) [DEFAULT]

The QR code of an NFC-e carries a state URL with the access key as a parameter (`?p=<key>|...`). The photo is the address of the data, not the data.

- **V1:** the founder pastes the QR URL or the 44-digit key into the tool; V1 validates the check digit and records it. The item lines are typed from the state page by us, only for the missing items. Concierge, but structured.
- **V2:** automated fetch from the QR URL for **SP and PR only**, after a spike that confirms each state page can be read without a captcha. Hard rule: no captcha circumvention, no portal automation beyond the public consumer URL.
- **WhatsApp capture:** V3. Until then, photos arrive on the founders' own WhatsApp.

### D14. Mapping fiscal descriptions to canonical ingredients [DEFAULT, needs one yes from you]

The ingredient graph is the asset. V1 approach:
1. GTIN present: look up by barcode.
2. Rules: normalized text plus NCM plus unit.
3. LLM suggestion (Claude API) for what rules do not match, **always confirmed by a founder** before it enters the catalog; every confirmation stored so the next client of the same category maps automatically (this is how E7 and I5 get measured).

The yes I need: calling the Claude API from the product with purchase descriptions (supplier name, item, price; no personal data). It costs a little per mapping and needs an API key on the Mac mini.

### D15. Recipes and yield [DEFAULT]

Recipes for the top 20 items are built by us in the onboarding session and entered in an xlsx template (item, ingredient, grams, yield). V1 imports the template. Yield is a declared parameter with a confidence label, as the cost document recommends. Error bars on cost are shown, not hidden.

---

## E. Decision logic

### D16. What V1 computes [DEFAULT]

Not a "refuse or approve" engine like the trust layer; that is the V3 approval flow. V1 is a calculator with stable rule IDs, so every number in the deliverable can be traced:

| Area | Examples of rules (IDs to be fixed in the spec) |
|---|---|
| Expected settlement per order | `REP-01` commission per plan; `REP-02` payment fee; `REP-03` delivery fee by distance; `REP-04` promotion split (who funds what) |
| Differences | `DIF-01` commission above contract; `DIF-02` cancellation charged to the store; `DIF-03` co-funded promotion debited wrongly; `DIF-04` missing settlement. Each tagged certain, probable or doubtful, as in E1 |
| Cost | `CST-01` latest observed price per canonical ingredient; `CST-02` regional and category prior when no invoice exists; `CST-03` yield adjustment |
| Contribution | `CTB-01` contribution per item per channel = net price after channel costs minus ingredient cost minus packaging |
| Deliverable | `DLV-01` the three "positions that surprise", chosen by explicit criteria, not by hand |

The list of difference types for E1 is still open with Manuel (item 3 of section 11 of the experiment plan). The spec will take whatever you two close.

---

## F. Design and surfaces

### D17. Who uses what in V1 [DEFAULT]

| Who | Surface |
|---|---|
| Founders | Command line (`margo ingest`, `margo map`, `margo close`, `margo deliver`) plus a local web page on the Mac mini to review mappings and differences. No login (local only) |
| Restaurant owner | The deliverable: a PDF and an xlsx, in Portuguese, generated from markdown or HTML on disk |
| BPO (V2b) | Same deliverable with the BPO's logo and colors |

### D18. Visual identity [DEFAULT]

Reuse the landing page's tokens so the deliverable looks like the same company: dark paper `#111314`, ink `#EDEEEC`, **"take" red `#D9685A`** for what the platform or the cost takes, **"keep" green `#2FA486`** for what the restaurant keeps, Fraunces for titles, Public Sans for text, IBM Plex Mono for numbers. One adjustment: the PDF needs a light version (white paper) because owners print and forward it; the "take" and "keep" colors stay.

---

## G. Architecture and stack

### D19. Stack and hosting [DEFAULT]

| Layer | Choice | Why |
|---|---|---|
| Language | Python 3.12 with `uv` | Same as the playbook; strong XML, CSV and Excel libraries |
| Storage | SQLite on the Mac mini (encrypted disk), schema = the canonical record: ingredient, dish, channel, fee, order, action | Data stays local in V1; easy move to Postgres later |
| Analysis | `polars` or `pandas` | Statements are tabular |
| External calls | `httpx`, offline tests with `respx` | Same as the playbook |
| Deliverable | Jinja templates to markdown or HTML, then `pandoc` or `weasyprint` to PDF; `openpyxl` to xlsx | Matches your markdown-first rule |
| Local review page | FastAPI plus plain HTML, local only | Small, no framework to learn |
| Agent interface | None in V1. Module boundaries written as if they were API calls, so V3 is a wrapper, not a rewrite | Respects the freeze |
| V2b shared folder | Google Drive folder per BPO | You already use Drive; no server to run |

---

## H. Data, safety and legal

### D20. Build agents never see real client data [BLOCKING, strong recommendation]

This is the MargoAI version of the playbook's rule "the agent never holds the dangerous credentials". When Claude Code agents read a file, its content goes to the model. So:

1. Real client data lives in a folder **outside the repository** (for example `~/MargoData/`), denied to build agents in the permissions file.
2. Agents build and test against synthetic fixtures and anonymized golden cases (store names replaced by codes, CNPJs removed, values kept).
3. Real runs are commands you or Manuel type. The output goes to the data folder, never to git.
4. The secret scan in the acceptance plan also scans for CNPJ and CPF patterns.

The alternative (letting agents debug on real files) is faster when a parser breaks on a real export. If you want that, it needs the owner's consent to cover AI processing, which our current authorization text does not mention.

### D21. Owner authorization and data terms [BLOCKING before the first real file, not before the spec]

Written authorization from the owner per CNPJ, covering: which data, for what, who processes it (including AI tools), retention and deletion. One page, Portuguese. I can draft it in the spec's `docs/` folder; a lawyer should read it before E4.

### D22. Hard rules carried into CLAUDE.md [DEFAULT]

No automation of logged-in portal sessions; no captcha circumvention; no certificate custody in V1 and V2; no `git push`; no real data in git, logs or prompts; every synthetic or manual path labeled as such in every output; money in integer cents; business dates in `America/Sao_Paulo`; no em dashes in anything the product writes.

---

## I. Later, recorded

- **D23 [LATER].** Open Delivery reconciliation module, when it leaves beta, as the multichannel source.
- **D24 [LATER].** WhatsApp Business API for photo capture and coupon approval (V3).
- **D25 [LATER].** Client portal with login, multi-tenant, hosted outside the Mac mini (V3; Supabase is a candidate since it is already connected).
- **D26 [LATER].** MCP server exposing `contribution` to external agents. The playbook pattern applies unchanged when the freeze ends.

---

## What is left before the spec

The seven questions that were here were answered on 30/out (section 1), and D41 to D48 closed the rest that blocked the spec. The spec is in `margoai-spec/` (project docs `claude/margoai-spec/*`). Everything tagged [DEFAULT] goes into the spec as written unless changed.

---

## Sources

- Maritime, how it works (sleep and wake, persistent volume, encrypted env vars): https://maritime.sh/docs/how-it-works
- Maritime, triggers (cron and webhook, URL as the only secret): https://maritime.sh/docs/triggers
- Maritime, security (US or Germany regions, SOC 2 underway, AES-256-GCM secrets): https://maritime.sh/security
- iFood Developer, getting started (test store and test app on registration): https://developer.ifood.com.br/en-US/docs/guides
- iFood Developer, financial homologation answered from the test environment: https://developer.ifood.com.br/en-US/docs/guides/modules/financial/homologation

- iFood Developer, authentication (OAuth 2.0, grant types): https://developer.ifood.com.br/en-US/docs/guides/authentication
- iFood Developer, centralized flow: https://developer.ifood.com.br/en-US/docs/guides/authentication/centralized
- iFood Developer, distributed flow: https://developer.ifood.com.br/pt-BR/docs/guides/modules/authentication/distributed
- iFood Developer, financial module v3 and homologation: https://developer.ifood.com.br/es-CO/docs/guides/financial/v3
- iFood Developer, Reconciliation On Demand: https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-reconciliation-ondemand
- Alterdata, authorizing an app in the Partner Portal: https://ajuda.alterdata.com.br/spicebase/integracao-alterdata-spice-e-ifood-como-autorizar-a-conexao-318539833.html
- 99Food, promotions and the Excel financial statement: https://99app.com/99food/restaurantes/guias/promocoes-e-taxas-99food/
- ABC da Comunicação, 99Food and Keeta join Open Delivery: https://www.abcdacomunicacao.com.br/99food-e-keeta-concluem-integracao-ao-open-delivery/
- NFe.io, inbound NF-e requires the company's A1 certificate: https://nfe.io/docs/distribuicao-nfe-cte-inbound/index.md
- Projeto ACBr, recipient acknowledgment deadline cut to 90 days from 1/jun/2026: https://www.projetoacbr.com.br/forum/tags/Manifestacao%20do%20destinatario/
- Oobj, NFC-e QR code URL parameters: https://oobj.com.br/bc/rejeicao-396-como-resolver
- Asaas, hosted checkout: https://docs.asaas.com/docs/checkout-asaas
- Asaas, checkout with recurring subscription: https://docs.asaas.com/docs/checkout-com-assinatura-recorrente
- Asaas, create subscription and free trial via nextDueDate: https://docs.asaas.com/reference/assinaturas-1
- iFood merchant list fields (id, name, corporateName), as shown in a public client library: https://root.packagist.org/packages/bee-delivery/laraifood
