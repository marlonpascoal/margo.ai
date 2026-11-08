# 04. Rules

Every number the product shows traces back to a rule ID (D16). Rule IDs are stable; code, tests and screens reference them. Values marked **param** live in a settings table, not in code.

## 1. M1. Price X-ray

| ID | Rule |
|---|---|
| `M1-01` | Neighborhood: public stores within `radius_km` (default 3, options 2, 3, 5; param) of the target. When the target has a discovery, only the stores it found are candidates. Distance by haversine when both stores have coordinates, else the `distance_km` of the latest discovery copy of the target; a store with neither stays out |
| `M1-02` | Competitive set: a store is a candidate when its discovered search terms or item taxonomies intersect the target's (the categories chosen in C02 and the `taxonomy_level2` of the target's items), ignoring case and accents; a side with no terms says nothing and the store stays; otherwise "regra: outra categoria". These search terms choose stores; the item categories of M1-04 are another list and do not enter here. Exclude stores closed more than 30 days (only with an explicit open signal in a copy: a store never seen open has no closed days), national chains with list prices, and stores that do not deliver to the target's neighborhood, each a toggle in C02 |
| `M1-03` | Unit normalization: items sold by weight or pack are converted to price per base unit (g, ml, un) before comparing; the item shows `normalizado`. A `unit_qty`, or a `unit` of g, ml or pack, from a copy always wins. Without them, when the copy is applied (`app.size_from_name_m1_03`, the only place), the size is read from the item name: ml, l, litro(s), g, kg and unit counts such as "12 unidades" or "6 un", ignoring case and accents, decimals as "1,5 l" or "1.5l", "s/" and "c/" read as words, a leading menu code dropped, a size glued to a word, the same size twice as one, converted to g, ml or un, and recorded as read from the name (`unit_from_name`). Ambiguous means no parse: a combo or a list of items ("Combo X-Bacon + Fanta 350ml", "Batata 200g + molho"), two different sizes, any other number in the name, "Pizza 8 pedaços". An item only compares with items in the same base unit |
| `M1-04` | Pairing, Stage 1 (Marlon, 07/nov), no AI. **Category:** one of `bebidas`, `lanches`, `porcoes`, `pratos`, `sobremesas`, `adicionais` (fixed list, Marlon has the final say), from `taxonomy_level2` when it names one, else the menu section (`public_menu_item.category`, ignoring non-sections such as "Os Mais Vendidos" and promotions), else rules on the name, else a description that says bread or rice; a name that can only be a drink is `bebidas` under any section. **Hard block before any name comparison:** items pair only within one category; add-ons never pair with another category; a combo (a pack without a count, "combo", "kit", "+", food and a drink in one name, a burger "com batata", more than one count such as "2 batatas 2 latas", or a section that opens with the word combo) pairs only with combos; a quantity ("4 X", "2 - X", "dois X", "X 2x"; a padded or long number such as "03 - X" is a menu code) pairs only with the same quantity, in every category. An item with no category pairs with nothing on its own: `revisar`, "categoria não identificada", with same-name items listed for a founder (never add-ons). **Beverages:** type, brand, flavor, variant (sugar-free; with or without gas; no alcohol; juice with water or with milk) and size must all match; the size is the one in M1-03 (1 l = 1000 ml; a row whose unit says nothing takes `size_from_name_ml`). Two different values mean the pair does not exist. Identical attributes confirm the pair, however many stores sell it, and record similarity 1. A brand or flavor absent on both sides is equal, the same generic item; absent on one side, or a size or type missing on either, is never accepted and is only listed for a founder when the name is close. A beverage goes to `revisar` only with its reason in `pair_note`: "tipo ilegível", "tamanho ilegível", "marca ilegível", "sabor ilegível", or "nenhuma loja com os mesmos atributos". C04 "Exemplo de par" of a beverage is always an accepted item. **Default sizes** (Marlon, 07/nov): a single beverage of a known type with no size takes a default, a size like any other: `m1.default_ml.agua` (param, 500) with no container word; else the size a brand and container (lata, long neck, KS, garrafa, pet...) states in at least `m1.default_size_min_share` (param, 0.8) of at least `m1.default_size_min_rows` (param, 5) rows of the X-ray's captured menus; else `m1.default_ml.<type>.<container>` (params: refrigerante and cerveja lata, 350). An explicit size always wins; never an unreadable type, a combo or a quantity. The pair keeps the default (`size_presumed_ml`, priced per 100 ml) and says it in `pair_note`, "tamanho presumido N ml"; a founder's review still wins. **Every category but bebidas, Stage 2** (Marlon, 07/nov): attributes by rule from the name, the description filling what the name leaves out: base (lanches: dog, burguer, beirute, wrap...; porções: batata, isca...; pratos: pizza, sushi, marmita, espeto, massa...; sobremesas: açaí, sundae, bolo...; adicionais: bacon, maionese, queijo...), flavors (sobremesas and pizza; a pizza's always must match), pieces (sushi), volume in ml, proteins (a burger's beef and a dog's sausage implied when no other patty is named), patty count (duplo, triplo, "2 hambúrgueres"), weight in grams when written, portion size (pequena, média, grande, N pessoas), extras the name lists. Items pair only with the same proteins and patty count, and the same base, weight and portion size where both state them (weight, volume and portion do not count for an item normalized per 100 g or 100 ml); extras: an extra main ingredient makes it different (a protein), cheese, salad or other extras alone do not (proposed default, Marlon decides). Among those, a name sharing at least `attribute_floor` (param, 0.01: one word) of similarity is a candidate; inside a store the closest name wins. At least `min_pairs` stores pair it; fewer is `revisar`, "poucos pares"; none is `exclusivo`, "exclusivo, sem comparação": not a problem, outside parity, loss and the Pareto, named under the C05 table, and a founder can still pair it in C04. A lanche whose protein, a porção or prato whose type and protein, a pizza whose flavor, or a sobremesa or adicional whose type the rules cannot read goes to one structured AI call per X-ray (name, description, category only; skipped without ANTHROPIC_API_KEY, the result then being the rules alone); an answer only fills attributes, a pair still needs them to match. Each answer is learned by pattern (category, name tokens, description words of the rule lists): `m1.attr_learning_min_runs` (param, 3) X-ray runs with the same answer and no other promote it, applied with no AI call; another answer disputes it; a founder's C04 pair decision on such an item wins over the AI. **An item with no category or a combo** keeps the name rule: when both items have a taxonomy, candidates of another taxonomy are out (level 2 when both have it, else level 1); an item pairs automatically when at least `min_pairs` (param, default 5) distinct stores have an item of the same category with name similarity at or above the threshold (param); below it, `revisar`, "poucos pares" when some store has one and "nenhum item parecido" when none does: a similar name is no proof of the same product, so a founder decides. Removed items take no part. A founder's decision stays on every re-run, even on a pair the rule would now block, while the store is in the set |
| `M1-05` | Parity needs accepted items from at least `min_pairs` distinct stores, unless a founder reviewed the item; a store counts once, its duplicate or identical rows collapsing into its lower median price per base unit. A paired item short of stores has no parity and C05 names it, "Sem paridade, poucas lojas vendem o mesmo item". Parity = median normalized price of accepted comparable items, computed twice over the same items and M1-03 normalization (dual parity, Marlon, 07/nov). **Current parity** (`parity_cents`) uses the current price: `price_cents`, or `minimum_price_cents` when `price_cents` is 0; an item with neither takes no part. **Full parity** (`parity_full_cents`) uses the full price: `original_price_cents` when present, otherwise the current price; with no promotion the two are equal. A run uses its snapshot prices, where a null full price means the current price of that run. **Known limit:** a permanently discounted item's full price counts as real; the promotion-history step that would catch it is a later stage |
| `M1-06` | Gap = (own price minus parity) / parity, like with like: own current against current parity (`gap_pct`), own full against full parity (`gap_full_pct`) |
| `M1-07` | Reading, the more cautious of the two gaps, same 10% (param): either gap at or above plus 10% is `nao_mexer` (raising is safe without cost data, lowering is not); otherwise both gaps at or below minus 10% is `pode_subir`; otherwise `na_media`. A `na_media` item with the full gap at or below minus 10% sets `full_price_room`: C05 and P01 add "pode subir quando os vizinhos não estão em promoção". C05 and P01 keep the current parity and gap as the main numbers, and show the full ones as secondary information only when the full parity differs from the current one. A run calculated before dual parity has a null full parity and shows none |
| `M1-08` | Loss per item = (current parity minus own current price) times expected weekly units when known, else 1, so the promised value is not inflated; Pareto ranks items by loss; the report states how many items carry 80% of the loss. **Limits:** no cost, no volume, no elasticity: a raise adds revenue per sale but may reduce sales, so the "loss" is a price gap, not money or profit; confidence on a recommendation needs product costs, which are not offered yet |
| `M1-09` | The PDF shows the top 3 `pode_subir` items by loss and lists `nao_mexer` items with the "do not lower without cost" message (P01) |
| `M1-11` | Capture ranking (Marlon, 07/nov): among the stores that passed M1-01 and M1-02, a score from 0 to 100, and the top `m1.extract_max_captures_per_xray` (param, 30) are captured, plus the target. Parts, weights normalized by their sum: rating count, weight `m1.rank_weight_ratings` (param, 50), `log(1 + count) / log(1 + highest count among candidates)`, 0 with no count or a highest of 0; proximity, `m1.rank_weight_distance` (param, 30), `1 - distance / radius` clamped to 0..1, 0 when unknown; category overlap, `m1.rank_weight_terms` (param, 20), the share of the target's terms (C02 categories and its own) the store shares, ignoring case and accents, 0 when none. The rating value does not enter. Ties: smaller distance, unknown last, then store id. Score and rank are kept on `xray_store`, null for stores from before this rule; a later capture never rewrites them; a new discovery of the X-ray recalculates them, for that X-ray only. A place given stays given, so no re-run queues past the cap or twice. A founder's manual inclusion wins over the filters and changes no rank; it takes a free place after the ranked stores. Stores past the cap keep score and rank and show as not captured by the cap, neither missing nor failed |
| `M1-12` | **Marlon, 07/nov (migrations 20261230000002, 20261231000002; docs/m1-owner-journey-draft.md).** "% de itens alinhados", per run for the menu and per M1-04 category, over the items with a parity and an M1-07 reading, counted (not weighted by units): score = round(100 × items read `na_media` / items read). It replaced v2 (share of the neighborhood price the store charges), which sat near 98 on real menus and barely moved. Beside it, never folded in: the counts below (`pode_subir`) and above (`nao_mexer`, "risco"), "diferença de preço por venda" (`price_gap_per_sale_cents`, Σ (parity − own price) of the `pode_subir` items) and the per-item position below. A category with fewer than `m1.score_min_items` (param, 5) items has no score, only its count. The change since the previous run of a monitoring covers only the items scored in both, with their count. Each value keeps its formula version (`m1-12.v3`); screens show only the current version, so a line never mixes formulas. Stored per run beside the M1-10 store position, never rewritten: the M1-10 method per category (rank among stores with at least `m1.rank_min_items` items of the category) and, per own item with a parity, its percentile among the accepted comparable stores (0 cheapest, 100 dearest) and its rank among the stores selling it. A run calculated before this rule has none of them. **Limits:** no cost, no volume, no elasticity: a raise adds revenue per sale but may reduce sales; the score says nothing about money or profit, and confidence on a recommendation needs product costs, which are not offered yet |

Collection (D47c): `m1.extract_every_days` (param, 7) is the longest a store of an active X-ray goes without a capture. Active: the newest X-ray of each target that left `draft`, except a lead's delivered X-ray and synthetic accounts; its target and the stores in its set that hold a capture place (M1-11) are captured. `m1.extract_max_running` (param, 20) is the safety ceiling of how many extract jobs run at once, across every extractor; the server decides, atomically.

Retry in the queue (Marlon, 07/nov): the extractor makes one attempt per claim and reports it; MargoAI decides (`docs/extract-api.md`). Each fail reason is transitory or permanent in `m1.extract_retry_reason_<reason>` (param, 1 or 0), the only place that decides: `blocked`, `timeout`, `network` and the 02 §4.5 `stuck` are transitory; `not_found`, `parse_error`, `other` and any unknown reason are permanent. A job has `m1.extract_max_attempts` (param, 3) attempts in all, the first included, counted in `job.attempts`, one per claim, each with its own `extract_run`. A transitory failure with attempts left returns the same job (same id, same capture place, same dedupe key) to `queued` with `not_before` = now plus `m1.extract_retry_wait_minutes_1` (param, 10) after the first attempt or `m1.extract_retry_wait_minutes_2` (param, 30) after the second and later; otherwise the job fails. While it waits it is pending, not finished: it counts against the `m1.pair_min_captures_pct` share, the daily cron queues no second job for the store, and C03 shows the store as waiting to retry with the time in São Paulo ("nova tentativa às 16:40"); if pairing runs without it, it is left out of pairing like a capture still running, and C03 shows both, with the retry time. It counts as failed only after its final failure.

Pairing does not wait for every capture (Marlon, 07/nov): C03 "Confirmar" and `xray_pair` run once `m1.pair_min_captures_pct` (param, 90) of the X-ray's capture slots have finished, done or failed, rounded up; the target counts as a slot and stores past the cap do not. The target's own capture must be done and its menu present: a target with no menu never pairs. An active `xray_neighborhood` job still blocks (`public.xray_pair_blocker`: `captures`, `neighborhood`, `target`). A stuck capture ends through 02 §4.5. A store whose capture is still running or waiting to retry takes no part and is marked (`xray_store.left_out_of_pairing`), and C03 names it; a capture that finishes after pairing updates that store's data only, and the pairing changes only when a person runs it again. A re-run replaces the pairs and the mark: stores no longer in the set leave, a founder's decision on a store still in it stays, and `xray_item` is recalculated.

## 2. M2. Expected payout and differences

Expected payout per order, from `contract_terms` and `campaign`:

| ID | Rule |
|---|---|
| `REP-01` | Commission = commission_pct of the plan in force on the order date, on the base the channel uses (items, or items plus delivery when the store delivers) |
| `REP-02` | Payment fee = payment_fee_pct on the amount paid online |
| `REP-03` | Delivery: in channel-delivery plans the delivery fee belongs to the channel; in store-delivery plans it is passed through |
| `REP-04` | Promotion split: for each campaign, the store pays `1 - channel_share_pct` of the discount and the channel pays the rest |
| `REP-05` | Expected payout = gross minus REP-01 minus REP-02 minus the store's share in REP-04 plus or minus REP-03 |

Differences, each with confidence (D16, E1):

| ID | Finds | Default confidence |
|---|---|---|
| `DIF-01` | Commission charged above the contract rate | certa |
| `DIF-02` | Cancellation charged to the store when the cancellation reason is the channel's or the customer's | provavel |
| `DIF-03` | Co-funded promotion debited in full from the store | certa |
| `DIF-04` | Order delivered with no payout entry after the expected payment date plus 7 days | certa |
| `DIF-05` | Refund charged to the store with no matching complaint | duvidosa |

The final list of difference types is open with Manuel (decisions, D16); new types are added as new IDs, never by changing an existing one. A difference below R$ 5,00 total per rule per month (param) is recorded but not shown.

## 3. Contestation status (D30)

```
a_contestar --(dono: "Já contestei" + protocolo optional)--> contestada
precisa_resposta --(dono: "Foi combinado? Sim")--> closed (no difference)
precisa_resposta --(dono: "Não")--> a_contestar
contestada --(system: matching credit found in repasse)--> creditada
contestada --(dono or staff: "Foi negada")--> negada
a_contestar --(system: deadline passed)--> prazo_vencido
```

- Only the system sets `creditada`, by matching a `ledger_entry` of type `adjustment` or `refund` to the difference within 10% of the amount and after `marked_at`.
- `prazo_vencido` is set by a daily job; the deadline per channel is a param (iFood default: as stated in the portal for each claim type; until confirmed, 30 days from the order).
- `provavel` differences start as `precisa_resposta`; `certa` start as `a_contestar`; `duvidosa` stay in the console only.
- Claim text (C16) is generated from a template per rule ID with the numbers filled in; the owner copies it into the app's portal. MargoAI never files the claim (D30).

## 4. M3. Cost and contribution

| ID | Rule |
|---|---|
| `CST-01` | Ingredient price = latest confirmed invoice price per base unit in the last 90 days (param) |
| `CST-02` | No invoice in 90 days: regional prior for the ingredient category, flagged `estimativa regional`, and widens the error bar |
| `CST-03` | Yield adjustment: cost per dish line = qty / yield_pct times price |
| `CST-04` | Error bar per dish = combination of yield confidence (medido 2%, declarado 5%, estimado 10%; params) and share of CST-02 prices |
| `CTB-01` | Contribution per order = price minus channel take (commission, payment fee, store share of promotion) minus ingredient cost minus packaging |
| `CTB-02` | A row is flagged "can invert" when the error bar is larger than the contribution |
| `DLV-01` | The closing PDF picks "one decision for the month": the top-20 item with the largest drop in contribution caused by an active campaign, else the item with the lowest positive contribution |

## 5. Permissions (D33)

Owner portal:

| Action | Dono | Financeiro | Gerente de cozinha |
|---|---|---|---|
| See close and what is left | yes | yes | own kitchens only |
| See and mark contestations | yes | yes | own kitchens only |
| Send purchase invoices | yes | yes | own kitchens only |
| See price X-ray | yes | yes | own kitchens only |
| Choose kitchens in analysis | yes | no | no |
| Plan, card and invoices | yes | no | no |
| Invite and remove people, change profiles | yes | no | no |
| Delete account and data | yes (code confirmation) | no | no |

Constraints: an account always has at least one Dono; removing or demoting the last Dono is refused. A person sees all kitchens or the chosen ones (`all_kitchens`, `membership_kitchen`).

Console:

| Area | Fundador | Operação |
|---|---|---|
| Clients, X-rays, imports, de-para, recipes, deliveries, contestations, alerts | yes | yes |
| Subscriptions, pilots, BPO prices (C15, C18 prices) | yes | no |
| Settings: secrets status, staff invites (C14) | yes | no |
| Feature toggles (C20) | yes | no |

## 6. Feature flags (D34)

Defaults per plan (sandbox and production keep separate values). "Off in all plans" means not launched.

| Key | What it turns on | Raio-X | Lucro | Rede |
|---|---|---|---|---|
| `m1.raio_x` | Price X-ray from public data | on | on | on |
| `m1.concorrente` | X-ray of a store that is not the account's own (competitor), up to `plan.competitor_xrays_per_month` per São Paulo month: Raio-X 0, Lucro 3, Rede 10, edited in C15 (Marlon, 31/out) | off | on | on |
| `m1.extracao` | Extraction through an external extractor (06 §10): the `extract_discover` and `extract_capture` jobs and the daily cron. On in sandbox and off in production, in all three plans | on in sandbox, off in production | on in sandbox, off in production | on in sandbox, off in production |
| `m2.ifood_api` | iFood reading through the official API | off | on | on |
| `m2.extensao_chrome` | Chrome extension | off | on | on |
| `m2.arquivo_99food` | 99Food statement import | off | on | on |
| `m2.arquivo_ifood` | iFood portal export import (D45) | off | on | on |
| `m2.contestacao` | Differences and contestation | off | on | on |
| `m3.notas_xml` | Accountant's XML zip | off | on | on |
| `m3.nfce_qr_auto` | Automatic QR reading (SP and PR) | off | off | off |
| `m3.depara_ia` | AI ingredient suggestion | off | on | on |
| `m3.custo` | Recipes, cost and contribution: C12, C13, the contribution job, W01 "sobrou" and the "sobrou" of the E01 close e-mail, its WhatsApp and W08 example, which say "falta custo" while off (Marlon, 31/out, 01/nov) | off | on | on |
| `conta.multi_cozinha` | More than one kitchen per account | off | on | on |
| `conta.pessoas` | Invite people and profiles | off | on | on |
| `bpo.marca_propria` | Closing report with the BPO's brand | off | off | off |
| `l.painel_dono` | Owner dashboard (L01) | off | off | off |
| `l.aprovacao_cupom` | Coupon approval on WhatsApp (L02) | off | off | off |
| `auth.whatsapp_code` | Login code by WhatsApp (needs the WhatsApp Business Platform, D36) | off | off | off |

During the free trial the account gets the Lucro defaults. Evaluation: override for the account if any, else plan default, for the current env. Implemented behind OpenFeature with our own provider reading these tables.

## 7. Account lifecycle and billing (D27, D28, D37)

- Sign-up (P07, W06) creates `account`, `company`, first `kitchen`, `person`, `membership(dono)` and `subscription(status=trial)` with `trial_ends_at = now + plan.trial_days` (param, placeholder 14).
- Trial reminders: 3 days before and on the day (notice `trial_ending`, e-mail locked on).
- Trial ends without a plan: `subscription.status=free`, plan Raio-X; channel imports stop (sources paused), data kept.
- Choosing Lucro opens Asaas hosted checkout (recurring, card only); status changes only from Asaas webhooks. `units_billed` = kitchens with `in_analysis=true` (or channel stores, if `plan.billing_unit` changes; D40).
- Rede: "Falar com a gente" creates an alert for the founders; no checkout.
- Pilot (C15): months 1 and 2 a separate Asaas charge of `pct_months_1_2` of the amount credited that month (sum of `creditada`), capped at `cap_cents`; from day 61, fixed monthly subscription. No last-minute discount (E6).

## 8. Login and recovery (D35)

- Code: 6 digits, valid 10 minutes, 5 tries, then 15-minute lock. Resend after 60 seconds.
- Sessions: computer 30 days, phone 30 days, console 12 hours. "Sair de todos os aparelhos" revokes all sessions.
- Contact change (e-mail or WhatsApp): code on the new channel, notice on the old one, `security_lock` of 24 hours on plan and people changes by the person who changed the contact, in every account they belong to. The lock holds back only that person: a Financeiro or Gerente who changes their e-mail does not block the Dono; a Dono who changes theirs is the one locked (Marlon, 01/nov).
- Sole Dono who lost both channels: founders verify against the CNPJ and articles of association, then re-invite (P17).
- Invite: 7 days, single use, shows inviter, role and kitchens (P18).

## 9. Notifications (D36)

| Code | Notice | Who | When | E-mail | WhatsApp |
|---|---|---|---|---|---|
| `close_ready` | Fechamento do mês pronto | Dono, Financeiro | day 5 of each month | on | on |
| `new_difference` | Diferença nova no repasse | Dono, Financeiro | when an import finds one | on | off |
| `deadline_soon` | Prazo de contestação chegando | Dono, Financeiro | 3 days before | on | on |
| `credit_confirmed` | Crédito confirmado no repasse | Dono, Financeiro | when found | on | off |
| `data_stale` | Dados parados | Dono | extension silent 3 days, or iFood authorization revoked | on | on |
| `invoices_missing` | Notas faltando | Dono, Financeiro | a top-20 ingredient has no price | off | on |
| `weekly_summary` | Resumo da semana | all profiles | Monday 8h | on | off |
| `trial_ending` | Teste grátis acabando | Dono | 3 days before and on the day | locked on | on |
| `billing_result` | Cobrança aprovada ou recusada | Dono | each Asaas charge | locked on | off |
| `security_event` | Pessoa nova ou login em aparelho novo | Dono | immediately | locked on | off |

- Billing and security notices always go by e-mail (locked).
- Quiet hours: no WhatsApp between 22h and 8h São Paulo; held messages go at 8h.
- Until the WhatsApp Business Platform exists, WhatsApp notices are `whatsapp_manual`: they appear in the console as a ready click-to-chat link for a founder to send (D36).
- Templates: `apps/web/emails/` (E01, E02 drawn; others follow the same layout).

## 10. Team alerts (C21)

| Severity | Examples | Channel |
|---|---|---|
| urgente | API import failed twice (token, permission); card charge refused | team e-mail plus WhatsApp to founder on duty |
| medio | extension silent 3 days; contestation deadline in 3 days; file with new columns | team e-mail |
| baixo | trial ends in 2 days without a plan; new iFood store without kitchen | team e-mail |

An alert stays open until someone resolves it; resolving writes `resolved_by`.

## 11. Imports (D31)

- iFood API: daily at 06:00 São Paulo for each authorized store, re-reading the last 7 days.
- Extension: uploads once per day when the owner opens the Partner Portal; silence of 3 days raises `data_stale`.
- Files: upload, BPO folder or WhatsApp, all into the same queue.
- Duplicate rows across runs count once (natural keys in 03-data-model).
- A file whose columns do not match a saved `column_mapping` goes to `needs_mapping` (C17); after the mapping is saved, the file reprocesses and the total of the payout column must match the file's own total, else the run fails.
- A real file is refused unless the CNPJ has an `owner_authorization` (C14).
