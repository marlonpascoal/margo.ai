# 01. Product

MargoAI tells a delivery restaurant how much is left from each order, per kitchen and per app, after what the app takes and after the cost of ingredients. It also finds what the apps charged wrong and helps the owner claim it back.

Source of every decision in this spec: `docs/decisions.md` (D01 to D48). If this spec and a decision disagree, stop and ask; do not pick one.

## 1. Who uses it

| Who | Surface | Login |
|---|---|---|
| Founders (Marlon, Manuel), role **Fundador** | Console, `/console` | E-mail plus 6-digit code, invited e-mails only, 12-hour session (D35) |
| MargoAI operations staff, role **Operação** | Console, without billing, secrets and feature toggles (D33) | Same |
| Restaurant people: **Dono**, **Financeiro**, **Gerente de cozinha** | Owner portal, `/app`, responsive: the same pages on phone and computer (D32) | Code by WhatsApp or e-mail, 30-day session on computer (D35) |
| Restaurant owner's browser | Chrome extension, computer only (D32) | Per-person token issued by the portal |
| BPO partner (pilot E8) | Shared folder plus a closing report with the BPO's brand | None in V1 |

## 2. Modules, in build order (D01, D45)

| Module | What it does | Data source | Needs the owner? |
|---|---|---|---|
| **M1. Price X-ray** | Compares each menu item with comparable items of stores within 3 km and ranks the gaps. Output: a 2-page PDF with "three prices you can raise today" | Public iFood store pages only (D47) | No |
| **M2. Channel close** | Monthly close per kitchen and app; expected vs actual payout per order; differences with the rule that found them; contestation tracking | iFood: portal export files first, then the official API (OAuth, D39); 99Food: Excel statement; extension for what the API does not give | Yes, signed authorization per CNPJ (D21, D48) |
| **M3. Cost and contribution** | Purchase invoices to ingredient prices, recipes for the top 20 items, contribution per item and channel | Accountant's XML zip, NFC-e keys and QR links, recipe template | Yes |
| **Account and billing** | Sign-up, free trial, plans, Asaas checkout, people and permissions, notifications | Asaas (D27) | Yes |
| **After 15/fev (flags off)** | Owner dashboard (L01), coupon approval (L02), agent API and MCP | | Design only |

## 3. What V1 must do by 16/nov (D45)

1. Base: login, accounts, entity model, feature flags, job queue, notifications, audit log.
2. M1 end to end on the Pantanos Burguer test case.
3. M2 from files: import an iFood reconciliation export and a 99Food statement for a group, produce the monthly close, the differences and the contestation texts.
4. The founders can deliver the E4 report (closing PDF) for a real group, with real data only in prod.

V1 is **accepted** against the synthetic group `G-SYN` and **done** only when it reproduces one real hand-calculated case (D46).

## 4. Out of scope, on purpose

- No automation of a logged-in portal session, no captcha circumvention, no browser agent holding a restaurant password (D01a, D22).
- No custody of digital certificates (A1) in V1 or V2 (D12).
- No POS integration now (D10). Item mix comes from the extension, portal reports or a CSV template.
- No changes to the restaurant's prices, menu or promotions, ever. MargoAI reads; the owner acts.
- Keeta and Rappi: entity model supports them, importers do not exist yet.

## 5. Glossary (Portuguese terms kept in the code)

| Term | Meaning |
|---|---|
| Conta | The group that pays. One subscription per conta |
| Empresa | A CNPJ inside a conta. Invoices attach here |
| Unidade, cozinha | A physical kitchen with one address; can host several brands. Billing unit by default (D40, open) |
| Marca | A brand sold from one or more kitchens |
| Loja de canal | One brand at one kitchen on one app. On iFood it is the `merchant` (UUID). Has its own public URL (D29) |
| Repasse | What the app pays the restaurant for a period |
| Fechamento | Monthly close per kitchen and channel |
| Diferença | Gap between expected and actual payout, found by a rule (`DIF-xx`) |
| Contestação | The claim the owner files in the app's portal for a difference |
| Raio-X | The M1 price comparison |
| Paridade | Median price of comparable items in the radius |
| Insumo | Canonical ingredient in the catalog |
| De-para | Mapping from an invoice line to an insumo |
| Ficha técnica | Recipe: grams of each insumo per dish, with yield |
| Contribuição, sobra | Price minus what the channel takes minus ingredient cost, per order |

## 6. Later, recorded (not in this build)

Open Delivery reconciliation as a multichannel source when it leaves beta (D23); WhatsApp Business Platform for photo capture, login codes and coupon approval (D24, D36); MCP server exposing contribution to external agents, hosted on Maritime (D26, D42).

## 7. Language (D04)

Code, specs and agent instructions in English. Everything a restaurant or a founder reads on screen, in PDFs, e-mails and WhatsApp texts in Brazilian Portuguese, exactly as drawn in the screens (`design/`). No em dashes in any product text (D22).
