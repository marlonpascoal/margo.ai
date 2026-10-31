# fixtures/m1: recorded public iFood pages (M1, D47)

Nothing is recorded yet. The collector's page parser (`workers/collector/src/margo_collector/ifood_public.py`)
waits for these recordings: until they exist, the `collect` job stops before making any request, with the
reason `AwaitingRecordings` (shown in C03). No page here may be invented (D40, 06).

## What Marlon runs

From the repository root, on the Mac mini, one command per set of pages:

```sh
# 1. The test store's public page (Pantanos Burguer, D03).
uv run collector record \
  --url "https://www.ifood.com.br/delivery/londrina-pr/pantanos-burguer-igapo/<uuid>" \
  --out fixtures/m1/pantanos

# 2. The public pages that list the stores around it, for the categories of C02
#    (open them in the browser first and copy the URLs; add one --url per page).
uv run collector record --url "<listing page URL>" --out fixtures/m1/vizinhanca-lista

# 3. A handful of neighbor store pages from that listing (enough for the parser tests).
uv run collector record --url "<store URL 1>" --url "<store URL 2>" --out fixtures/m1/vizinhanca-lojas
```

`--contact <e-mail>` changes the contact address in the user agent (default `contato@margoai.com`).

## What the command does (D47)

- Only `https://www.ifood.com.br` public pages; the Partner Portal, login pages and other hosts are refused
  before any request.
- User agent `MargoAI-coletor/1.0 (+https://margoai.com; <contact>)`, no cookies, no credentials.
- At most one request every 3 seconds.
- Stops at the first captcha or block (HTTP 401, 403, 429, a challenge page, a redirect to login) and exits
  with code 2, keeping what it already recorded. It never retries.
- Before writing, removes e-mail addresses, phone numbers, CPF and CNPJ numbers. Store names, item names,
  prices and units stay.
- Writes `NN-<page>.html` plus `manifest.json` (URL, time, size, sha256, how many personal matches were
  removed, and `stopped` with the reason when it stopped).

## After recording

1. Check `manifest.json` and open the pages: nothing personal left (reviews with customer names, for
   example, need removing by hand before committing).
2. Confirm on the target page whether the uuid in the URL is the store's `merchant.id` (D29).
3. Tell the build agent which recordings to use; it codes the parser against them, with tests that replay
   them, and B01 then runs from recorded pages instead of the seed's canonical rows.
