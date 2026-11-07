# Extract API: the contract for any extractor

This is the only contract between MargoAI and whatever reads store pages (today the external `margoai-menu-scraper`, D47b; later the extension or a licensed feed). It replaces the scraper's `supabase-contract.md`. An extractor holds this token and no database credential: it only extracts, and all logic lives in MargoAI.

Examples below are synthetic. The complete bodies are in `fixtures/m1/extract/`, labeled SINTÉTICO.

## Flow

1. Poll `POST /api/extract/claim`. One job runs at a time across all extractors, so a claim while another job runs answers 204.
2. Do the job.
3. Send `POST /api/extract/result`, or `POST /api/extract/fail` if it could not be done.

## Auth

Every request: `Authorization: Bearer <MARGO_EXTRACT_TOKEN>`. With a wrong token, no token, or the variable unset on the server, the answer is 401.

## Statuses

| Status | Means |
|---|---|
| 200 | Done |
| 204 | Claim only: no work |
| 401 | Bad token |
| 404 | Unknown job |
| 409 | The job is not running (already finished or requeued) |
| 413 | Body over 4 MB |
| 422 | Invalid body, listed in `"errors": [..]` |

## POST /api/extract/claim

```json
{ "worker": "scraper-mac-mini" }
```

204 with no body when there is no work. Otherwise 200:

```json
{
  "job_id": "3f1c0000-0000-4000-8000-000000000001",
  "kind": "discover",
  "payload": {
    "url": "https://www.ifood.com.br/delivery/cidade-sintetica-pr/alvo-sintetico/5e000000-0000-4000-8000-000000000001",
    "radius_km": 3,
    "categories": ["Lanches", "Hambúrguer", "Porções"]
  }
}
```

A capture's payload has the url only:

```json
{ "job_id": "3f1c0000-0000-4000-8000-000000000002", "kind": "capture", "payload": { "url": "https://www.ifood.com.br/delivery/cidade-sintetica-pr/vizinha-a/5e000000-0000-4000-8000-000000000002" } }
```

## POST /api/extract/result

`job_id`, `source` (`"scraper"`, `"extension"`, `"licensed"`, ...), `collected_at` (ISO 8601 with a zone, at most a day ahead of the server's clock) and one of `discover` or `capture`, matching the job's kind.

### discover

```json
{
  "job_id": "3f1c0000-0000-4000-8000-000000000001",
  "source": "scraper",
  "collected_at": "2026-10-31T10:00:00-03:00",
  "discover": {
    "target": { "external_id": "5e000000-0000-4000-8000-000000000001", "url": "https://...", "name": "Alvo Sintético", "address": "Rua Sintética, 100", "lat": -10.0, "lng": -40.0, "is_open": true },
    "stores": [
      { "external_id": "5e000000-0000-4000-8000-000000000002", "url": "https://...", "name": "Vizinha A Sintética", "category": "Lanches", "distance_km": 1.2, "search_terms": ["Lanches"], "taxonomies": ["HAMBURGUERES"] }
    ]
  }
}
```

`target` is a STORE. Each entry of `stores` is a STORE plus:

| Field | Type | Used for |
|---|---|---|
| `distance_km` | number | M1-01: the distance from the target while the store has no coordinates. Without it and without coordinates the store cannot enter the neighborhood |
| `search_terms` | array of strings | M1-02: compared with the categories of the request (`payload.categories`), ignoring case and accents. Send the terms from that list that surfaced the store |
| `taxonomies` | array of strings | M1-02: compared with the `taxonomy_level2` of the target's items |

A store with neither `search_terms` nor `taxonomies` stays a candidate. A store with terms that match nothing is shown as excluded, "regra: outra categoria".

### capture

```json
{
  "job_id": "3f1c0000-0000-4000-8000-000000000002",
  "source": "scraper",
  "collected_at": "2026-10-31T10:10:00-03:00",
  "capture": {
    "store": { "external_id": "5e000000-0000-4000-8000-000000000002", "url": "https://...", "address": "Avenida Sintética, 200", "lat": -9.99, "lng": -40.0 },
    "items": [
      { "external_item_id": "item-a-1", "name": "Hambúrguer sintético duplo", "taxonomy_level2": "HAMBURGUERES", "price_cents": 2800, "original_price_cents": 3200, "unit": "un" },
      { "external_item_id": "item-a-2", "name": "Monte seu lanche sintético", "price_cents": 0, "minimum_price_cents": 1900 }
    ]
  }
}
```

### STORE

| Field | Required | Type | Notes |
|---|---|---|---|
| `external_id` | yes | string | The channel's id. In a job's own store (the discover target, the capture store) it must be the store the job asked for |
| `url` | yes | string | https |
| `slug` | | string | |
| `name` | | string | |
| `category` | | string | The store's primary category |
| `main_category_code` | | string | |
| `super_categories` | | array of strings | |
| `rating` | | number | 0 to 5 |
| `rating_count` | | integer | |
| `address` | | string | Street address. Internal only: it reaches no screen, PDF, message, snapshot or export (D47c) |
| `area` | | string | Neighborhood or locality |
| `lat`, `lng` | | number | |
| `is_open` | | boolean | Send it only when the page says so. `true` moves "last seen open" to `collected_at`; do not derive it from having read the page |

### ITEM

| Field | Required | Type | Notes |
|---|---|---|---|
| `external_item_id` | yes | string | |
| `name` | yes | string | |
| `description` | | string | |
| `category` | | string | The item's menu section |
| `taxonomy_level1`, `taxonomy_level2` | | string | The channel's taxonomy. M1-04 compares items of the same taxonomy |
| `price_cents` | yes | integer | The current price |
| `original_price_cents` | | integer | The price before a promotion. Stored only |
| `minimum_price_cents` | | integer | Used when `price_cents` is 0 |
| `unit` | | `"g"`, `"ml"`, `"un"`, `"pack"` | Default `"un"` |
| `unit_qty` | | number | Required when `unit` is `"g"` or `"ml"`. For a pack, the units in it; leave it out for a combo of different items |

### Answers

200:

```json
{ "ok": true, "copies": 4, "dropped": ["_label", "discover.stores[].reviews"] }
```

- `copies` counts the stores written.
- Unknown fields are dropped, not rejected, and named in `dropped`. Never send raw HTML or customer reviews. A known text field holding an HTML document is refused with 422.
- A null counts as absent.
- Sending the same `job_id` again after a success changes nothing and answers 200 with the same `copies` and an empty `dropped`.

422 lists what to fix; the job stays running, so a corrected result can follow:

```json
{ "errors": ["capture.items[0].price_cents: required"], "dropped": [] }
```

Also refused with 422: a capture with an empty `items` (it would mark the whole menu removed; use `fail`), and `unit` `"g"` or `"ml"` without `unit_qty`.

## POST /api/extract/fail

```json
{ "job_id": "3f1c0000-0000-4000-8000-000000000002", "reason": "blocked", "detail": "403 na página da loja" }
```

`reason`: `blocked`, `not_found`, `parse_error`, `timeout` or `other`. `detail` is optional, kept up to 500 characters, internal. Keep it free of personal data. 200 `{ "ok": true }`.

## What MargoAI does with a result

- Each store becomes a dated copy that is never rewritten. Identical content is stored once.
- The catalog updates at once. A field a copy lacks is left as it was, and a founder's choices (national chain, store taken out of a set) are never touched.
- A capture carries the complete menu, so for an item in it a missing `original_price_cents` or `minimum_price_cents` means there is none now, and the stored value is cleared. A discovery copy never clears them.
- An item missing from a newer capture is marked removed, never deleted; it returns if a later capture lists it.
- Older copies arriving late do not overwrite newer values.

## Retries

- **Polling:** claim every few seconds to a minute; a 204 costs nothing.
- **Network error or 5xx on `result` or `fail`:** retry with the same body. A repeated success is harmless.
- **401, 404:** stop and check the token or the id; retrying will not help.
- **409:** drop the job. A job that runs past 30 minutes returns to the queue once, and then fails with an alert (02 §4), so finish or `fail` well before that.
- **422:** fix the body or send `fail`. Do not resend it unchanged.
- **413:** the limit is 4 MB. Drop optional fields such as `description`; if it still does not fit, send `fail` with `other`.
- A failed job is not retried by MargoAI at once: a failed capture comes back with the next daily cron, and a failed discovery needs a new X-ray in C02.
