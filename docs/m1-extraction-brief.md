# M1 extraction brief: what the price X-ray needs, and how to feed it

Written 31/out after iFood answered the collector's first real request with a 403. The collector stopped, as D47 requires, and recorded nothing. Marlon is choosing a different strategy; this file holds everything that strategy has to deliver, whatever it is.

## 1. Where things stand

- The X-ray pipeline is built end to end: C02 (new X-ray) → C03 (collection) → C04 (pairing) → C05 (parity and gaps) → C06 (delivery) → P01 PDF, plus the history (M1-10).
- Today it runs on the G-SYN seed's canonical rows (`supabase/seed/g_syn_m1.sql`, `g_syn_m1_hist.sql`). The seeded X-ray is `9aae2f75-4168-fde3-4570-d7bd0f4669d0` (G-01, Pantanos Burguer).
- The live path is `workers/collector`: a polite fetcher (`fetcher.py`, D47) and a page parser (`ifood_public.py`). The parser is still a stub, `UnrecordedPages`, because no real page has been recorded: D40 and 06 forbid coding a parser against invented pages.
- The first request, to Pantanos Burguer's public page with the MargoAI user agent, got HTTP 403. Nothing was retried and nothing was stored.

## 2. What the X-ray needs (the data contract)

Whatever the source (recorded pages, an owner upload, typed prices, an official channel), it has to fill these two tables. Everything after that (pairing, parity, gaps, Pareto, PDF) already works.

### Per store: `public_store`

| Field | Required | Used by | Notes |
|---|---|---|---|
| `external_id` | yes | D29 | The iFood uuid at the end of the store URL `ifood.com.br/delivery/{cidade-uf}/{slug}/{uuid}` |
| `url` | yes | C02, P01 | Canonical form: https, www, no query |
| `name` | yes | C03, C05, P01 | |
| `category` | yes | M1-02 | "Lanches", "Hambúrguer", "Pizza", ...: the competitive set filters on it |
| `lat`, `lng` or `area` | yes | M1-01 | Distance from the target kitchen, radius 2, 3 or 5 km (default 3). The area (bairro) alone works only if we accept "same and adjacent neighborhoods" instead of a radius |
| `last_seen_open_at` | yes | M1-02 | Excludes stores closed more than 30 days |
| `is_national_chain` | yes | M1-02 | Excludes chains with list prices (a founder can set it by hand) |
| delivers to the target's area | optional | M1-02 | A C02 toggle; if the source cannot tell, the toggle stays off |

### Per menu item: `public_menu_item`

| Field | Required | Used by | Notes |
|---|---|---|---|
| `external_item_id` | yes | dedup, history | Any id stable between runs of the same store |
| `name` | yes | M1-04 | Pairing by name similarity: comparable at 0.6, automatic at 0.75 with at least `min_pairs` (5) |
| `description` | optional | M1-03, M1-04 | Helps find weight or size ("180 g", "500 ml") |
| `price_cents` | yes | M1-05, M1-06 | The current price shown; when a promotion is on, the price before the discount too, if visible (open: which one counts) |
| `unit`, `unit_qty` | yes when sold by weight or pack | M1-03 | g, ml, un; null `unit_qty` for a mixed combo |
| `collected_at` | yes | M1-10 history | When the price was seen |

### Per item of the target store only

| Field | Required | Used by | Notes |
|---|---|---|---|
| expected weekly units | optional | M1-08 | Ranks the loss for the Pareto. Without it every item counts 1. Real values can come from the owner, or from M2 sales once imports run |

### Size of a useful run

- The August Espeto Burguer run (D03): 107 stores, 646 items, 8 of 29 items carrying 80% of the loss. Use it only as a sanity check on orders of magnitude.
- For one X-ray: the target store's full menu, plus every store of the chosen categories within the radius. In Londrina that is roughly 50 to 120 stores.
- Pairing needs at least 5 comparable items per target item to be automatic; below that, a founder reviews it in C04.

## 3. What no strategy may do

These come from CLAUDE.md, D47 and D01b, and stay true for any new strategy:

- **No circumvention, ever:** the run stops on any block or captcha. That rules out:
  - changing the user agent to look like a browser
  - rotating IPs or proxies
  - headless browsers built to look human
  - retrying after a block
- **No logged-in sessions automated** (hard rule 5). Nothing reads iFood through an owner's login, except the extension acting on the page the owner opened.
- **No personal data kept:**
  - reviewer names
  - phone numbers
  - CPF numbers
  - addresses of people
- **Legal consult (D01b) before the first X-ray delivered outside the test case.** The block raises the weight of that consult: a 403 to an identified bot is a clear signal of iFood's position.
- **Every manual or synthetic path is labeled as such** in what the owner sees.

## 4. Ways in that already exist in the code

1. **Recorded pages:** `uv run collector record --url ... --out fixtures/m1/<name>` (`fixtures/m1/README.md`). This path is blocked as long as iFood answers 403.
2. **Canonical rows**, the way the seed loads them: `public_store` plus `public_menu_item` rows, then the `xray_pair` and `xray_calc` jobs. A loader for a CSV or JSON file in the contract of section 2 is small work (an import step plus a C02 option "dados enviados"), once the source is chosen.

## 5. How the extraction was done before this project (Cowork, August)

**Not available to this build.** The Cowork project's files, including `margoai-experimentos.md` (17/out) and `margem-coleta-de-custo.md`, are not in the repo or on this Mac. The Espeto Burguer scripts and raw data were not available either (D03), and the Notion page "Extração do iFood" is empty. The automation inventory only says "runbook nas notas, sem script na pasta".

To decide whether the old method can come back, fill this in from the Cowork project:

- **Source:**
  - web pages (www.ifood.com.br)
  - the app's JSON endpoints
  - the iFood mobile app
  - screenshots
  - a third-party dataset
- **Tool:**
  - Claude in Chrome or another browser agent
  - a script (Python, Playwright)
  - by hand
- **Session:**
  - logged in or not
  - which account and location (delivery address) was set
- **How the 107 stores were chosen:**
  - radius or area
  - categories
  - the listing or search used
- **Fields captured per store and per item:** compare with section 2.
- **Rate and duration:**
  - how many requests
  - how long it took
  - whether anything was ever blocked
- **Pairing method:** how the 29 own items were matched to competitors (by hand, by name, by AI).
- **Output:** file format (JSON, CSV, sheet). If any file survives, put it in `fixtures/m1/` after removing personal data, and it becomes the parser's test input.

## 6. Candidate strategies (for Marlon's decision)

| Strategy | Fits D47 and rule 5 | Effort here | Notes |
|---|---|---|---|
| Owner saves pages in the browser and uploads them | yes | parser + upload in C02 | The browser loads the pages, so iFood sees a normal visit. Pages must be parsed as saved HTML |
| Extension reads the store and listing pages the owner opens | yes, if limited to pages the owner opened | extension content script + parser | Same parser as above; the owner already installs the extension for M2 |
| Founder types prices (first X-rays) | yes | CSV loader in section 4 | Labeled manual. Slow, about 1 to 2 hours per X-ray |
| iFood permission or an official channel | yes | none until granted | Slow; the only route back to automatic collection |
| Licensed third-party menu data | depends on the provider's own terms | CSV loader | Check the provider's source and license before buying |
