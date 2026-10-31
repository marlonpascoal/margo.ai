# Build review: open items for Marlon

Collected during the build (Waves 0 to 3) for one review at the end. Nothing here changes `docs/decisions.md`; each item is a question or a stand-in to confirm.

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
  - P02 text follows C06 ("2 páginas"), not the P02 drawing.
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
