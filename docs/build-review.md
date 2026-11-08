# Build review: open items for Marlon

Collected during the build (Waves 0 to 3) for one review at the end. Nothing here changes `docs/decisions.md`; each item is a question or a stand-in to confirm.

## Review answers (Marlon, 31/out)

- **Live M1 collection after the 403:** Marlon will choose a different strategy. Everything it has to deliver is in `docs/m1-extraction-brief.md`, with a section to fill from the Cowork project on how the August extraction was done.
- **Extension clicks Export:** yes, as 05, 06 and P04 say: a content script on the Partner Portal page the owner opened (rule 5). C07's "Envia sozinha uma vez por dia" becomes true.
- **Billing units:** only stores of kitchens in analysis are billed, as built. The G-SYN seed and its screens show 5 stores and R$ 1.500, not the drawn 6 and R$ 1.800.
- **AI prompt:** sends supplier name and price too, as 06 §6 and D14 say.
- **C10 against C12:** seed data only, so it waits; to settle when real invoices arrive.
- **Channel take (CTB-01):** the rule as written in 04 §4 (commission, payment fee, promotion). The drawn values in C13, P06 and W01 no longer match.
- **Coupons:** contribution uses the funding split M2 records, not the store paying the full discount.
- **X-ray of competitor stores:** yes, limited per plan (a plan field plus a flag): Raio-X grátis 0, Lucro 3, Rede 10 a month, editable in C15.
- **Quiet hours:** urgent founder alerts go by WhatsApp at any hour; everything else waits until 8h.
- **W09 login e-mail:** each person changes their own; the Dono can change anyone's.
- **Invoice access key:** unique per account, not globally, so no account learns about another's invoices (amends 03 and D11).
- **Gerente invites:** at least one kitchen must be chosen; for other roles, none still means all.
- **Deletion 90 days after leaving:** not scheduled now; a founder deletes from the console. Listed for go-live.
- **Cancelled subscription:** back to Raio-X, imports paused, data kept, as built.
- **Ingredient rules, hybrid:**
  - A confirmation in C11 becomes a rule of that account and confirms automatically there.
  - Globally, the rule only suggests until 3 accounts confirm it with no disagreement (param `m3.global_rule_min_accounts`).
  - Any disagreement demotes it and flags it for a founder.
  - Two rules pointing to different ingredients send the line to review.
- **M1-10 ranking:** approved, with stores ranked only when they share at least 3 items with the target (param `m1.rank_min_items`).
- **Pilots:** at day 61 a pilot converts to the plan price unless a founder set pilot terms in C15. Failed charges are still never resent automatically.
- **Flag `m3.custo`:** gates C12, C13, the contribution job and W01 "sobrou"; "Gerar fechamento mensal" moves to it.
- **PDF library:** decided later, with the visual direction and the fonts.
- **Everything else in this file** is accepted as built and parked for go-live: seed-only numbers, internal names, M2 confidence labels, and copy written without a drawing (to be read as one sheet).
- **For `docs/decisions.md`:** Marlon pastes the rows in `docs/decisions-amendments-draft.md`.

**M1 source (Marlon, 07/nov):**
- M1 consumes the external `margoai-menu-scraper`, which uses Bright Data Web Unlocker. This replaces the fetcher D47 describes. Claude does not run the scraper or change how it fetches; Marlon connects it.
- The scraper only extracts: `discover` and `capture` work over HTTPS with its own token. Every copy is dated and kept; all logic lives in margo.ai.
- The legal consult (D01b) still comes before the first X-ray delivered outside the test case, unless Marlon changes that.
- **Decided (Marlon, 07/nov), dual parity:** a promotion is evaluated at the current and at the full price, and the reading takes the more cautious one; loss, Pareto and P01's top 3 stay on current prices (04 M1-05 to M1-09).

**Not drawn, added at Marlon's request (07/nov):** "Sair" in `Menu` (end of the sidebar) and `MenuDono` (next to the role, also on phone), ending this session only. The drawings need it.

**Before the first real X-ray PDF:**
- **P01 page 1:** the "Não mexa" list has no limit; from roughly 45 items it runs into the call-to-action box.
- **P01 list:** item names past about 44 characters run into the "Hoje" column.
- **C06:** "PDF · A4 · {n} páginas" shows the rendered count; before a file exists it shows only "PDF · A4", unlike the drawing.

### Open points from building the review answers

- **Extension: check on the real portal** (`fixtures/m2/extension/README.md`):
  - the page paths, assumed to start with `/financeiro`
  - the Export button's text, and whether it opens a menu or asks for a period first
  - how the file arrives (another host falls back to the manual pick)
  - whether the file is .csv or .xlsx

  With several stores, the daily send goes without a store. It exports whatever the open page exports, not "the requested report and period" (06 §9).
- **Hybrid rules, choices made:**
  - account rules win in their account
  - a rule conflict becomes a suggestion "conflito entre regras, revisar", with no price and no AI call
  - "Revisada" only clears the flag, and the rule waits for 3 accounts again
- **Competitor X-rays:** C02 takes `?conta=<code>` to set the account, since a competitor's store has no owner account. No drawing shows how C02 picks the account, so nothing links to it yet.
- **Pilots from day 61:**
  - a monthly single card charge at the pilot's "from month 3" price, or the Lucro price
  - no notice before the first charge, only `billing_result` after it; a heads-up needs a new notice in the spec
  - C15 still shows "a definir" for open terms
- **CTB-01:**
  - campaign rows show the menu price, and the store's half of the coupon sits in "Canal leva"
  - delivery and anticipation are in no contribution line and reach the owner only through the payout
  - C13 and P06 numbers no longer match the drawings: P06's sentence becomes "contra os". W01 "sobrou" and the E01 subject are unchanged.
- **`m3.custo`:** the "sobrou" line in the E01 e-mail and close notice is not gated. Gate it? C20 now lists more flags than drawn.
- **W09:**
  - The Dono changing someone else's e-mail never existed and has no drawing; not built.
  - When a Financeiro or Gerente changes their e-mail, 04 §8 locks plan and people changes for 24 hours on the account, which also blocks the Dono. Intended?
- **Seed only:** G-03 bills 3 units but has no stores, so the billing cron would set it to 0.

**Answers (Marlon, 01/nov):**
- **E-mail change lock:** the 24-hour lock applies only to the person who changed their login e-mail, not to the account.
- **Pilot notice:** none before the day-61 charge; the owner gets the billing result only.
- **"Sobrou" line:** gated by `m3.custo` in the E01 e-mail and the close notice too.
- **Dono changing others' e-mail:** no. The Dono removes the person and invites them again; P17 covers lost access.

**Left from building these:**
- **P17 drawing:** it still says "a conta fica 24 horas sem poder mudar plano ou pessoas". Since the lock now applies per person, the drawing needs a redraw.
- **New copy for the per-person lock:** the people banner, the refusals, and the W09 confirmations. It goes on the copy sheet.
- **With `m3.custo` off,** the close e-mail keeps the label "Sobrou depois dos insumos" with the value "falta custo", as W01 does.

## Commands only Marlon runs (live calls)

- **M1 public pages:** `uv run collector record --url <url> --out fixtures/m1/<name>` for Pantanos, the neighborhood listing and a few neighbors (`fixtures/m1/README.md`). Check for personal data (reviewer names) before committing. Until then B01 is proven from canonical seed rows only.
- **M2 sample exports:** anonymized iFood reconciliation and sales exports and a 99Food Excel statement (`fixtures/m2/README.md`). Until then C01 runs on synthetic layouts `gsyn-sintetico-v1`.
- **iFood developer account:** test-environment recordings for C05.

## Decisions to confirm

- **D40 billing unit:** the migration says per kitchen; only the G-SYN seed bills per channel store.
- **Flags:** with no account, a flag is on if any plan turns it on. Should `feature_flag_log` record which plan's default changed?
- **Notifier:** may urgent founder WhatsApp alerts break quiet hours (22h to 8h)? The manual WhatsApp link for the founder on duty points to their own number: intended?
- **Environment names not in 02 §6:** `MARITIME_AGENT_<TYPE>`, workers' `SUPABASE_URL`, `MARGO_TEAM_EMAIL`, `MARGO_FOUNDER_ON_DUTY`, `MARGO_COLLECTOR_LIVE`.
- **Job type names:** `collect`, `xray_pair`, `xray_calc`, `render_xray`, `import_ifood_api`, `import_ifood_file`, `import_99food_file`, `render_close`, `import_invoice_zip`, `match_ai`.
- **M1 (lane A):**
  - The M1-02 category rule is applied by the collector's search, because C03 draws a pizza store excluded manually.
  - Two similarity levels: comparable at 0.6 or above, auto-pair at 0.75 or above with `min_pairs`.
  - Pareto weekly units are a new column `xray_item.weekly_units`; where real values come from is open.
  - C04 review sets `reviewed_at` and keeps the rule status.
  - Pareto bars for Sundae and Molho are computed (8%, 7%), not the drawn 19% and 13%.
  - P01 "Não mexa" lists all 5 items above parity (drawing shows 2).
  - P02 text follows C06 ("2 páginas"), not the P02 drawing. C06 states the rendered file's page count: 2 for the seed, more when the list runs on.
  - Raw page cache (7 days, D47) may hold reviewer names.
  - Collector user-agent contact `contato@margoai.com`.
- **M2 (lane B):**
  - C08, C09, C16, C17 and P06 call the group "Pantanos Burguer"; the close is seeded under G-02 Grupo Exemplo.
  - To make C08 and C09 agree:
    - cancelled orders are left out of gross
    - a DIF-04 order sits in gross unpaid
    - an August second installment is paid in September
    - payouts count by payment date
  - Confidence:
    - DIF-02 is "certa" when the file says who cancelled and why
    - DIF-03 is "provável" for a promotion with no campaign
    - DIF-04 "provável" shows "esperando repasse", which is not in the status enum
  - "Foi combinado? Sim" sets `closed_at`; "closed" is not a status in 03.
  - The drawn deadlines (15, 20 and 22/nov) are seeded as drawn; new contestations get 30 days from the last order.
  - P06 "R$ 718 contestados" sums contestada and a contestar.
  - Long-format reconciliation files will need parser work, not just a mapping.
- **Two PDF libraries:** P01 uses reportlab, P06 uses fpdf2. Pick one later; Public Sans and IBM Plex Mono are not in the repo as TTF files.

## Copy written without a drawing

- **Wave 0:**
  - login messages (too soon, locked, wrong, expired)
  - alert e-mail and WhatsApp text
  - C20 controls and form, C21 "resolver" and "Nenhum alerta aberto."
  - C00 "Entrar"
  - flag descriptions for `m2.arquivo_ifood` and `auth.whatsapp_code`
- **M1:** in `apps/web/lib/xray/labels.ts`:
  - C02 errors, C03 progress and stop reasons
  - pairing, calculation and PDF notices
  - C04 marks and buttons, C06 hours error
  - P01 page 2 title, skipped-items footnote and short-list title variants
- **M2:**
  - C07: "Importar", "Canal do arquivo", "iFood (arquivo do portal)", failure labels
  - C17: "escolher" and refusal messages
  - C16: "Foi negada", "conferir o próximo repasse", "equipe"
  - C08 and C09: generated-close notice, "Nenhuma importação neste mês"
  - C19: the "vincular" selects
  - texts:
    - the DIF-04 certa and DIF-05 descriptions
    - the claim texts
    - P06 "falta custo" and "Fontes"

## Partial or stubbed

- **C01:** the M1 status, "raio-X entregues" and hours are stubs.
- **Console sidebar:** the C03 to C06 links are disabled.
- **Waiting on other work:**
  - "Buscar lojas no iFood de novo" (C05)
  - "Ver o que o dono vê" (W03)
  - the extension and M3 links
- **Python worker notices:** `credit_confirmed` and `new_difference` are not sent yet (no Python notify path).
- **`close_ready` before the 5th:** needs a cron.
- **REST repositories for Maritime workers:** arrive with the first deployed worker.

## Wave 2 (owner portal, billing, extension, e-mails)

### Commands only Marlon runs
- **Asaas sandbox:** `ASAAS_API_KEY='<sandbox key>' node scripts/record_asaas.mjs api`, pay the printed checkout link, then `node scripts/record_asaas.mjs webhooks <exported events>` (`fixtures/asaas/README.md`). The `E01_parse_recorded_*` tests run once the files land. E01 on the preview needs a freshly signed-up account.
- **Extension, loaded unpacked:**
  1. `MARGO_API_URL=<app url> pnpm --filter @margoai/extension build`
  2. Load `extension/dist` in `chrome://extensions` (Developer mode).
  3. Get a code from C07 "Ver a extensão".

### Decisions to confirm
- **Extension does not click Export.** 05, 06 and the P04 drawing say it clicks the Partner Portal's Export button. My brief to the agent was stricter than hard rule 5 (which allows acting on the page the owner opened), so the owner exports and picks the file in the popup instead. Say if you want the click; it is a content script on that one page. C07 still says "Envia sozinha uma vez por dia", which is not true now.
- **Partner Portal host** `https://portal.ifood.com.br` and the Chrome Web Store URL (`NEXT_PUBLIC_CHROME_WEB_STORE_URL`, button disabled until set).
- **Billing units:** only stores of kitchens in analysis are billed, which gives G-02 5 stores, not the drawn 6. The billing cron would change G-02 from R$ 1.800 to R$ 1.500 on the seed.
- **Pilots:**
  - nothing is created automatically from day 61
  - a pilot with an open percentage, cap or start is not charged
  - a failed pilot charge raises an alert and is never resent automatically
- **Subscriptions:**
  - "Ficar no grátis" only links to `/app`
  - subscription deleted returns the account to Raio-X and pauses sources
  - a refused card during the trial keeps the status
- **Asaas:** `SUBSCRIPTION_CREATED` is handled (not in 06 §4) so a conversion during the trial is not undone. PUT for subscription updates and the checkout field `link` are to be checked against the first recording.
- **Portal sign-up:**
  - `auth.whatsapp_code` is off, so the screens show e-mail only, and P07's footer says "no seu e-mail"
  - an existing contact creates nothing and gets the same answer
  - the trial uses the Lucro plan, and the account code is the next free `G-NN`
- **Invites:**
  - an e-mail invite logs in directly
  - a WhatsApp invite also asks for an e-mail
  - no kitchens chosen means all kitchens, but a Gerente then sees none
  - the Dono sends the invite link from their own phone; we send no invite e-mail
- **P17 "Perdi o acesso"** opens a team alert; the public endpoint needs a rate limit before go-live.
- **A03 on PDFs:** the account-wide close and X-ray PDFs only go to people with all kitchens. A Dono always has all kitchens.
- **W01:** "cobrado errado" sums differences rated certa or provável in scope, excluding closed ones. "Sobrou depois dos insumos" shows "falta custo" until M3. Seed totals (R$ 111.000) differ from the drawn R$ 248.000.
- **/app/conectar** is shown to the Dono and Financeiro, and only the Dono signs. One signature covers AI and international processing (D48). Terms version `rascunho-2026-10-30`, to bump when the lawyer's text lands.
- **People and kitchens:**
  - linking a new store to a kitchen is Dono only
  - the kitchen in-analysis toggle counts as a plan change during a security lock
  - with `conta.multi_cozinha` off, at most one kitchen is in analysis
- **E06:**
  - the export leaves out internal tables and columns named hash, token or secret
  - deletion also removes members who have no other account
  - the automatic deletion 90 days after a client leaves (02 §7) is not scheduled
- **WhatsApp manual queue** is a section of C21. C18 shows when `bpo.marca_propria` is on for at least one BPO client; branded PDFs are downloaded from C18 because the partner's folder is outside MargoAI.
- **E-mail:** the footer adds "SINTÉTICO · dados fictícios". E01 without cost says "falta custo". Nothing sends the outbox on a schedule yet (no cron). `MARGO_APP_URL` is needed for links.
- **New env names:** `ASAAS_API_URL`, `CRON_SECRET` (not in C14 yet), `MARGO_APP_URL`, `NEXT_PUBLIC_CHROME_WEB_STORE_URL`, `MARGO_API_URL` (extension build).
- **Seed invite `g-syn-convite-contador`** expires 05/nov, after which the P18 screenshot shows the invalid-invite page.

### Copy written without a drawing (Wave 2)
- **Portal entry:**
  - sign-up and invite errors, the invalid-invite page, the group chooser "Qual grupo abrir?"
  - P17 form, P08 statuses, W01 empty state, P11 placeholder
  - W09 log verbs, "Pessoa nova na conta"
- **Account:**
  - the invite form and invite text, the kitchen editor, the lock banner
  - people, Lojas, Contestações and Conectar messages
  - the deletion notice, the export `LEIA-ME.txt`
- **Billing:**
  - plan states and return-from-Asaas messages, invoice and C15 statuses
  - the C15 plan editor, last-event labels
  - trial_ending and billing_result texts, the billing alerts
- **Extension and e-mails:**
  - the 8 notices besides E01 and E02 (`apps/web/emails/notices.ts`), WhatsApp versions of E01 and E02
  - popup pairing and status texts, the C21 queue, the console extension page, C18 buttons and messages

### Wave 2 integration
- **W09 "Trocar" contact change is Dono only.** Spec 04 §8 does not say so; should Financeiro and Gerente change their own e-mail?
- **MenuDono shows every entry even when the page's flag is off** (the link answers 404).
- **An abandoned e-mail change** leaves an unused Auth user for the new address.
- **The P18 accept notice** still uses plain text, not the `new_person` template.
- **Copy without a drawing:** W09 messages for e-mail change, export and deletion; the W07 pairing-code line; the 409 "importações pausadas"; the e-mail "Seu e-mail de login mudou".

## Wave 3 (cost and contribution)

### Schema decisions
- **Invoice `access_key` is unique across all accounts** (03, D11). A second account sending the same key learns that it exists elsewhere.
- **Regional priors (CST-02) are stored per account**, because `ingredient_price.account_id` is required. The CST-02 widening of the error bar has no value in the spec.
- **Columns added beyond 03 §4:**
  - `invoice_line.line_no`
  - `ingredient_match.confidence`
  - `contribution.packaging_cents`
  - `account_id` on `invoice_line`, `ingredient_match` and `recipe_line` (for account isolation)
- **No upper limit on `yield_pct`:** cooked rice can yield more than 100%.
- **`invoice_line.unit_price_cents` is an integer.** Computations use `total_cents / qty` where precision matters.

## Product decisions raised by Marlon (31/out)

- **Live M1 collection before the legal consult.** Marlon released the X-ray on real public pages and the legal consult (D01b) comes later. CLAUDE.md now allows Claude to fetch public iFood pages within D47. Record this in `docs/decisions.md` as an amendment to D47; the rest of D47 still holds.
- **X-ray history.** Being built: dated snapshots per run, per-item price over time, and the store's overall ranking over time. Confirm the definition of "ranking geral da loja" when it lands.
- **X-ray of another store (competitor).** `xray` will record whether the target is an own channel store or another store. Open: should owners run X-rays on stores that are not theirs, and how many per plan? Proposal to discuss:
  - Raio-X grátis: own store only, 1 a month.
  - Lucro: own stores plus N competitors.
  - Rede: more.
  It would be a plan field, like `billing_unit` (D40), plus a flag. Legal weight is higher for third-party stores (D01b).
- **Retention strategy by plan** (later). To evaluate:
  - X-ray history as the reason to stay
  - a monthly re-run for paying plans
  - competitor tracking as an upgrade
  - what a free account keeps after the trial (E02 already pauses imports and keeps data)

### M1 history (branch m1/real-pages, merged 31/out)
- **M1-10, the price-index ranking:** approve it before it is written into spec 04.
- **Synthetic history in the seed:** an earlier 28/set Pantanos run, kept only as snapshots. Is that fine under D46?
- **C02 label:** should it show the own-store or competitor label?
- **Live collection after iFood's 403:** the first real request was blocked. The collector stopped and recorded nothing, as D47 requires. Options that don't work around the block:
  - the owner saves their own store page and uploads it
  - ask iFood for permission or an official channel
  - a founder types the prices for the first X-rays

### Wave 3 lanes: commands only Marlon runs
- **Anthropic recording:** `ANTHROPIC_API_KEY=... uv run record-anthropic [model-id]` writes `fixtures/anthropic/match-<date>.json`; check it before committing. Env names: `ANTHROPIC_API_KEY` (without it, the AI step is skipped) and `MARGO_MATCH_MODEL` (default `claude-sonnet-5-5`).

### Wave 3 lanes: decisions to confirm
- **What the AI prompt sends:** 06 §6 and D14 say supplier name and price; my brief to the agent was stricter, so it sends only the line description, NCM, unit and catalog names. Add supplier and price?
- **Lines sent to the AI** on a real account only when the owner's authorization has `includes_ai`.
- **Matching and learning:**
  - GTIN and rule matches confirm automatically only when the unit conversion is known
  - every confirmation by a person becomes a global `ingredient_rule`
  - C11 shows one row per invoice text, and confirming applies to every line with that text
- **Invoice intake:**
  - zip imports have their own table `invoice_import`
  - invoices to another buyer are skipped
  - a real account needs authorization with scope `notas` for every buyer CNPJ, or the whole run is refused
  - typed keys and QR links are only for single-company accounts
  - the P05 link opens WhatsApp with no number chosen
- **C10 against C12:** C10 draws cheddar and pão as "falta nota", but C12 prices them from notes. The build follows C11 and C12, so C10's four missing items are bacon, embalagem kraft, copo 400 ml and balde de papel; "16 de 20" still holds.
- **Channel take (CTB-01):** the drawn values only come out with the channel's whole share, (gross − payout) / gross, including delivery and anticipation. That is broader than 04 §4's commission, payment fee and promotion.
- **Error bar (CST-04):** each line's error is weighted by its cost, plus a new param `m3.regional_prior_error_pct = 0.30` for regional estimates. This reproduces the drawn ± 9%.
- **Coupon:** the store is assumed to pay the full discount, as drawn, while M2 records it co-funded 50/50. Coupons apply to single dishes through a new `campaign_item` table, with no screen to link them yet.
- **Packaging:** "embalagem kraft" is a recipe line; `packaging_cost` holds a channel's extra packaging.
- **W01 "sobrou"** is payout minus the cost of the dishes sold. Any dish without a ficha makes it "falta custo". The decision box shows only to people who see all kitchens.
- **E01 subject:** now "Setembro fechado: sobrou R$ X de R$ Y" once cost exists.
- **Order of rows:** C13 follows C12's order. P06 shows the best seller, the decision row and the lowest positive row, with full dish names.
- **Flags:** no 04 §6 flag covers C12, C13 or the contribution job. "Gerar fechamento mensal" in C13 uses `m2.contestacao`.
- **Not built:**
  - the recipe xlsx import (D15)
  - a screen that uses the P05 reply after a QR is read
  - iFood homologation prep (needs the developer account)
  - G01 / `G-REAL-1` (needs the anonymized real case)

### Copy written without a drawing (Wave 3)
- **C10:** import states and failure reasons, key and authorization warnings, the receipt form, "Falta 1 insumo" / "Nenhum insumo faltando".
- **C11:**
  - buttons: "Salvar troca", "Recusar sugestão", "Insumo novo no catálogo"
  - the new-ingredient fields
  - "escolhido no console"
  - the validation messages
- **P05:** "Falta 1 item", plus "Agora falta 1." and "Agora não falta nenhum." in the reply after a QR is read.
- **C12:** "custo recalculando", "sem preço", "Editar ficha", "Embalagem extra por canal", validation, empty states, "cupom de dd/mmm", error-bar explanation variants.
- **C13:** "pode inverter" and its notes, the empty month text, the DLV-01 second sentence (also on W01).
- **P06:** "menos da metade dos", "contra os", "Vale rever o preço?", the xlsx sheet "Sobra por pedido".

## Raio-X no portal: P19 to P24 / W10 to W15 (07/nov, branch nov/portal-xray)

**The screens follow the prototype pending drawings.** No `design/` file exists for P19 to P24 or W10 to W15 yet; the pages follow the prototype `m1-owner-journey.html` (session scratchpad) and `docs/m1-owner-journey-draft.md`, including its §10 provisional choices. When the drawings arrive, the pages are redrawn to them and `scripts/check_screens.py` starts checking them. Styles are the prototype's, in `apps/web/app/app/raio-x/raio-x.css`, tokens only. Strings not in the prototype are in `docs/copy-review.md` ("P19 to P24").

- **Routes**, behind `m1.portal`, menu item "Raio-X" between Início and Lojas (W10): `/app/raio-x` (P19/W10), `/app/raio-x/novo` (P20/W11, Dono only, 404 for others), `/app/raio-x/[monitor]/lendo` (P21/W12), `/app/raio-x/[monitor]/revisar` (P22/W13), `/app/raio-x/[monitor]` and `/app/raio-x/[monitor]/[xray]` (P23/W14), `/app/raio-x/[monitor]/historico` (P24/W15).
- **Score:** Marlon has not picked between "% de itens alinhados" and no score. Every score on these screens is drawn by `apps/web/app/app/raio-x/_components/PriceScore.tsx`, labeled "Score de preço", from `loadResult().positions` and `loadHistory()`; `SHOW_SCORE = false` there removes it everywhere.
- **PDF = the result page printed** (Marlon, 07/nov). "Compartilhar" offers "Baixar PDF" only. The route `/api/raio-x/[monitor]/pdf` checks the person, then serves the copy printed for the result `version` or queues `render_xray` in print mode. worker-render mints a one-time token (sha256 stored, 5 minutes, used once, `xray_print_token`), opens `/imprimir/raio-x/[xray]?t=` and prints it to A4 with Playwright; the file is cached per version in `xray_print`. The console's P01 (C05/C06) is unchanged.
  - **Needs Marlon:** Playwright is not a Python worker dependency. The worker calls Node Playwright from `apps/web` (`scripts/print_pdf.mjs`), so the render worker's container needs Node and Chromium, or the Python `playwright` package is added. It also needs `MARGO_APP_URL`, the web app it prints from.
- **Differences from the prototype:**
  - P20 for Financeiro and Gerente is 404 (05 convention), not the "Só o Dono pode..." banner. "Perto de qual cozinha?" lists kitchens without distances.
  - P21 has no "Tirar da comparação" (no backend for an owner's exclusion yet, draft §8).
  - P22 "Não é o mesmo" on a system-confirmed item opens its stores to unmark; the prototype only hinted at it.
  - P23 competitor view: the head-to-head comes from the newest own run whose neighborhood holds the competitor (new `monitor_head_to_head`), hidden when none does. Items do not repeat "Você cobra X neste item". "Ver as lojas" is left out of the PDF.
  - P24 product chart has no competitor line (the history loader has none). Charts use ink tones, no series colors (no token), and SVG titles instead of hover tooltips. The runs table shows "Itens comparados" instead of "Espaço para subir".
  - No dark theme (`tokens.css` is light only). The notices screen (`#avisos`) is not part of this work.
- **Exclusivo (pairing Stage 2, merged from main):** an `exclusivo` item is listed in "Itens só seus" ("ninguém por perto vende algo igual") and never as a doubt; doubts stay `revisar` only (migration `20261231000001`).
- **Backend fixes found by the screens:** `createMonitor` and `confirmSuggestions` omitted `p_kitchen` and `p_items` when null, and PostgREST could not find the functions. Both now send null (unit test pins it).
