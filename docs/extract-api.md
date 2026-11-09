# Extract API: the contract for any extractor

This is the only contract between MargoAI and whatever reads store pages (today the external `margoai-menu-scraper`, D47b; later the extension or a licensed feed). It replaces the scraper's `supabase-contract.md`. An extractor holds this token and no database credential: it only extracts, and all logic lives in MargoAI.

Examples below are synthetic. The complete bodies are in `fixtures/m1/extract/`, labeled SINTÉTICO.

## What changed for extractors (Marlon, 07/nov)

Retry moved from the extractor into MargoAI's queue.

- **One attempt per claim.** Do not retry a store inside a claim. Make one attempt, then send `result` or `fail` at once, and release the slot.
- **Send the reason that fits** (see [POST /api/extract/fail](#post-apiextractfail)). The server decides whether to try again: `blocked`, `timeout` and the new `network` are retried later; `not_found`, `parse_error` and `other` are final.
- **`network` is new:** use it for a connection failure (DNS, connection refused or reset, TLS error) before any page came back.
- **A page that never rendered** (for example the menu selector never appeared) is `timeout`, not `parse_error`. Send `parse_error` only for a page that rendered but could not be read.
- **The same `job_id` may come back** in a later claim: that is the server's retry, not a duplicate. Do the job again as if new.
- **Unchanged:** the endpoints, the bodies and the answers. The circuit breaker for a general block (many stores refused in a row) stays in the extractor: pause claiming, as before.

## Flow

1. Poll `POST /api/extract/claim`. Jobs run in parallel up to a limit the server decides (`m1.extract_max_running`, a safety ceiling, today 20; the extractor's own worker count is the real control) across all extractors; at the limit, or with nothing queued, a claim answers 204. The limit does not change how fast an extractor may read pages: it keeps its own pacing (D47).
2. Make one attempt at the job.
3. Send `POST /api/extract/result`, or `POST /api/extract/fail` if that attempt did not work. MargoAI decides whether the job is tried again ([Retry of a failed job](#retry-of-a-failed-job)).

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
| `rating_count` | | integer | M1-11: the main part of the capture ranking. Without it the ranking works from distance and terms only |
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
| `original_price_cents` | | integer | The price before a promotion. Enters the full parity (`spec/04-rules.md` M1-05) |
| `minimum_price_cents` | | integer | Used when `price_cents` is 0 |
| `unit` | | `"g"`, `"ml"`, `"un"`, `"pack"` | Default `"un"` |
| `unit_qty` | | number | Required when `unit` is `"g"` or `"ml"`. For a pack, the units in it; leave it out for a combo of different items. Without it, and with `unit` absent or `"un"`, MargoAI reads the size from `name` when it is unambiguous (M1-03); what you send always wins |
| `choices` | | array of CHOICE | The item's complement groups. Send it for items whose price depends on a choice (`price_cents` 0 with `minimum_price_cents`). `[]`: the complements were read and there are none. Left out or null on an item with a variable price: they could not be read, the menu and what is stored stay, and the job ends failed (`incomplete_choices`, not retried). A fixed price clears them |
| `type` | | string | The channel's item type, as it wrote it (a default item, a combo, a half-and-half pizza). Comes with the complements read and follows the same rule: left out or null keeps what is stored, a fixed price clears it |

### CHOICE

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | yes | string | The group's title, such as "Escolha a proteína" |
| `min` | yes | integer | Choices the customer must make. 1 or more: required group. 0: optional |
| `max` | yes | integer | Most choices allowed in the group. Not below `min` |
| `options` | yes | array, at least one | Each is `{ "name": string, "price_cents": integer }`. `price_cents` is what the option adds to the price: 0 means included |

Unknown fields inside a group or an option are dropped and named in `dropped`, as anywhere else.

### Answers

200:

```json
{ "ok": true, "copies": 4, "dropped": ["_label", "discover.stores[].reviews"] }
```

- `copies` counts the stores written.
- A 200 can still leave a capture job failed: see `choices` in ITEM.
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

`detail` is optional, kept up to 500 characters, internal. Keep it free of personal data; a short technical note such as the HTTP status or the selector that did not appear is enough. 200 `{ "ok": true }`, whether the job will be tried again or not.

| `reason` | Send it when | MargoAI |
|---|---|---|
| `blocked` | The channel refused this page: 403, 429, a block or captcha page | Tries again later |
| `timeout` | The page did not load or did not render in time, including a menu that never appeared | Tries again later |
| `network` | The connection failed before any page came back: DNS, refused, reset, TLS | Tries again later |
| `not_found` | The store does not exist at that url (404, store removed) | Final |
| `parse_error` | The page rendered, but its content could not be read into the contract | Final |
| `other` | Anything else | Final |

A page that never rendered is `timeout` even when the extractor noticed it as a missing element; `parse_error` is only for a page that rendered.

## What MargoAI does with a result

- Each store becomes a dated copy that is never rewritten. Identical content is stored once.
- The catalog updates at once. A field a copy lacks is left as it was, and a founder's choices (national chain, store taken out of a set) are never touched.
- A capture carries the complete menu, so for an item in it a missing `original_price_cents` or `minimum_price_cents` means there is none now, and the stored value is cleared. A discovery copy never clears them.
- An item missing from a newer capture is marked removed, never deleted; it returns if a later capture lists it.
- Older copies arriving late do not overwrite newer values.
- Captures go to the target and the top `m1.extract_max_captures_per_xray` stores of the ranking (M1-11); the others stay in the neighborhood with no capture job.

## Retry of a failed job

The extractor makes one attempt per claim and never retries inside a claim. MargoAI keeps the count and decides:

- Which reasons are retried is set per reason in `rule_param` (`m1.extract_retry_reason_<reason>`: 1 retried, 0 final), the only place that decides. Today `blocked`, `timeout` and `network` are retried.
- A job has `m1.extract_max_attempts` attempts in all, the first included (3). Each claim counts one, in the job's `attempts`; each attempt keeps its own run with its reason.
- After a retried failure with attempts left, the same job (same `job_id`) returns to the queue with a `not_before` time: `m1.extract_retry_wait_minutes_1` (10) after the first attempt, `m1.extract_retry_wait_minutes_2` (30) after the second. No claim offers it before then; after it, it takes its place by age again, oldest first.
- After the last attempt, or a final reason, the job fails as before.
- A job stuck in running past 30 minutes counts that claim as an attempt (reason `stuck`) and waits the same way; after the last attempt it fails with an alert (02 §4.5). No extra attempts.
- While it waits, the job is still pending, not finished: the daily cron does not queue a second job for the store, it counts as unfinished toward the pairing threshold (`m1.pair_min_captures_pct`), and if pairing runs without it the store is left out of pairing. C03 shows "nova tentativa às 16:40".
- A general block (many stores refused in a row) is the extractor's to handle with its own circuit breaker: stop claiming for a while. The server's retry is per job and does not replace it.

## Retries of requests

- **Polling:** claim every few seconds to a minute; a 204 costs nothing.
- **Network error or 5xx on `result` or `fail`:** retry with the same body. A repeated success is harmless.
- **401, 404:** stop and check the token or the id; retrying will not help.
- **409:** drop the job. A job that runs past 30 minutes counts as a failed attempt and returns to the queue while it has attempts left (02 §4), so finish or `fail` well before that.
- **422:** fix the body or send `fail`. Do not resend it unchanged.
- **413:** the limit is 4 MB. Drop optional fields such as `description`; if it still does not fit, send `fail` with `other`.
- A job that failed for good is not retried by MargoAI: a failed capture comes back with the next daily cron, and a failed discovery needs a new X-ray in C02.
