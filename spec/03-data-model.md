# 03. Data model

Postgres in Supabase. Migrations in `supabase/migrations/` are the contract between web (TypeScript) and workers (Python) (D43). Conventions:

- Primary keys `uuid` (`gen_random_uuid()`), `created_at`, `updated_at` on every table.
- Every tenant table has `account_id uuid not null` and an RLS policy.
- Money: `bigint` centavos, column suffix `_cents`. Percentages: `numeric(7,4)` as fractions.
- Business dates: `date` in `America/Sao_Paulo`; instants: `timestamptz`.
- Status columns are Postgres enums named in this document.
- Soft delete only where stated; deletion jobs hard-delete (D48).

## 1. Entities (D29)

| Table | Key columns | Notes |
|---|---|---|
| `account` | `name`, `code` (G-02, unique, shown in console), `plan_id`, `trial_ends_at`, `is_synthetic` | The group that pays |
| `company` | `account_id`, `cnpj` (unique per account), `legal_name` | Empresa |
| `kitchen` | `account_id`, `company_id`, `name`, `address`, `city`, `uf`, `lat`, `lng`, `in_analysis bool` | Unidade, cozinha. `in_analysis` drives billing (D28, D40) |
| `brand` | `account_id`, `name` | |
| `channel_store` | `account_id`, `kitchen_id null`, `brand_id null`, `channel` enum(`ifood`,`food99`,`keeta`,`rappi`), `external_id`, `name`, `corporate_name`, `public_url`, `listed bool`, `authorized bool`, `authorized_at`, `source` enum(`public`,`api`,`file`,`extension`,`manual`) | Unique (`channel`,`external_id`). `kitchen_id null` means "sem cozinha" (D29) |
| `channel_store_url_history` | `channel_store_id`, `url`, `seen_at` | Keeps every URL ever seen (slug changes) |
| `person` | `auth_user_id`, `name`, `email`, `whatsapp_e164` | One row per human |
| `membership` | `account_id`, `person_id`, `role` enum(`dono`,`financeiro`,`gerente`), `all_kitchens bool` | At least one `dono` per account (constraint trigger) |
| `membership_kitchen` | `membership_id`, `kitchen_id` | Used when `all_kitchens=false` |
| `invite` | `account_id`, `role`, `kitchen_ids uuid[]`, `channel` enum(`email`,`whatsapp`), `destination`, `token_hash`, `expires_at` (7 days), `accepted_at`, `invited_by` | P18 |
| `staff` | `person_id`, `role` enum(`fundador`,`operacao`), `invited_by` | Console access (D33, D35) |
| `session_device` | `person_id`, `user_agent`, `ip_city`, `last_seen_at`, `revoked_at` | W09 device list |
| `security_lock` | `account_id`, `person_id`, `reason`, `until` | 24-hour lock on the plan and people changes of the person who changed a login contact (D35, 04 §8) |
| `owner_authorization` | `account_id`, `company_id`, `scope text[]`, `includes_ai bool`, `includes_international bool`, `signed_by`, `signed_at`, `document_path` | No real file is processed for a CNPJ without one (C14, D21) |

## 2. M1. Price X-ray

| Table | Key columns | Notes |
|---|---|---|
| `xray` | `account_id null`, `target_store_id`, `radius_km`, `categories text[]`, `rules jsonb`, `status` enum(`draft`,`collecting`,`pairing`,`ready`,`delivered`), `delivered_at`, `pdf_path` | One run. `account_id` null for a lead without an account yet |
| `public_store` | `channel`, `external_id`, `name`, `url`, `slug`, `area`, `category`, `main_category_code`, `super_categories text[]`, `rating`, `rating_count`, `lat`, `lng`, `last_seen_open_at`, `is_national_chain` | Public catalog cache. `last_seen_open_at` moves only on an explicit open signal in a copy |
| `public_store_private` | `public_store_id`, `address`, `collected_at` | Street address (D47c). RLS on, no read policy; reaches no screen, PDF, message, snapshot or E06 export |
| `public_menu_item` | `public_store_id`, `external_item_id`, `name`, `description`, `category`, `taxonomy_level1`, `taxonomy_level2`, `price_cents`, `original_price_cents`, `minimum_price_cents`, `comparison_price_cents` (generated, M1-05), `unit` enum(`un`,`g`,`ml`,`pack`), `unit_qty numeric`, `unit_from_name boolean` (M1-03), `size_from_name_ml` (generated, M1-04), `choices jsonb` (complement groups, `docs/extract-api.md`), `item_type` (the channel's type, read with `choices`), `collected_at`, `removed_at` | An item missing from a newer capture gets `removed_at`, never deleted |
| `extract_run` | `job_id null`, `kind` enum(`discover`,`capture`), `source`, `worker`, `request jsonb`, `started_at`, `finished_at`, `status` enum(`running`,`done`,`failed`), `error`, `copies` | One attempt at an extract job (06 §10). RLS on, no policy |
| `extract_content` | `content_hash` (unique), `payload jsonb` | Allowlisted fields of a copy; identical copies reuse a row. May hold the street address, so RLS on, no policy. Append-only |
| `extract_copy` | `run_id`, `channel`, `store_external_id`, `collected_at`, `content_hash` | Dated copy of a store (D47c). Unique (`run_id`,`channel`,`store_external_id`). Append-only: a trigger refuses update and delete. RLS on, no policy |
| `xray_store` | `xray_id`, `public_store_id`, `distance_m`, `included bool`, `exclusion_reason`, `capture_slot bool`, `capture_score numeric null`, `capture_rank int null` (M1-11) | C03 |
| `xray_item` | `xray_id`, `menu_item_id`, `norm_unit`, `norm_price_cents`, `parity_cents`, `gap_pct`, `parity_full_cents`, `gap_full_pct`, `full_price_room bool`, `loss_cents`, `reading` enum(`pode_subir`,`na_media`,`nao_mexer`), `pair_status` enum(`auto`,`revisar`,`normalizado`,`manual`), `pair_note`, `item_category` (M1-04: `bebidas`,`lanches`,`porcoes`,`pratos`,`sobremesas`,`adicionais`, null when nothing says one) | C04, C05. `parity_cents`, `gap_pct` are at current prices, `_full` at full prices (M1-05, M1-06); a null `parity_full_cents` is a run from before dual parity |
| `public_menu_item_snapshot` | `xray_id`, `public_store_id`, `public_menu_item_id`, `name`, `price_cents`, `full_price_cents null`, `unit`, `unit_qty`, `collected_at` | A menu item in one X-ray run, never changed. `price_cents` is the M1-05 current price; a null `full_price_cents` means current, also in every run from before dual parity. A weekly capture does not reach it |
| `xray_pair` | `xray_item_id`, `public_menu_item_id`, `accepted bool`, `by` | Comparable items |
| `time_log` | `account_id null`, `xray_id null`, `step`, `minutes`, `person_id` | Hours per step (V1 criterion, C06) |

## 3. M2. Channel data and close

| Table | Key columns | Notes |
|---|---|---|
| `import_source` | `account_id`, `channel`, `kind` enum(`api`,`extension`,`upload`,`bpo_folder`,`whatsapp`), `schedule_cron`, `last_ok_at`, `stale_after_hours` | C07 cards |
| `import_run` | `account_id`, `source_id`, `trigger` enum(`schedule`,`extension`,`upload`,`rerun`,`manual`), `channel`, `store_ids uuid[]`, `period_start`, `period_end`, `file_path`, `rows_total`, `rows_new`, `rows_duplicate`, `duration_ms`, `status` enum(`queued`,`running`,`ok`,`failed`,`needs_mapping`), `log jsonb`, `job_id` | Import history (D31) |
| `column_mapping` | `channel`, `file_signature`, `mapping jsonb`, `created_by` | C17. Saved per file layout, reused |
| `order_fact` | `account_id`, `channel_store_id`, `external_order_id`, `ordered_at`, `gross_cents`, `items_cents`, `delivery_fee_cents`, `discount_store_cents`, `discount_channel_cents`, `status` | Unique (`channel_store_id`,`external_order_id`) |
| `order_item_fact` | `order_fact_id`, `item_name`, `external_item_id`, `qty`, `unit_price_cents` | From API if available, else extension or CSV (D07, D10) |
| `ledger_entry` | `account_id`, `channel_store_id`, `external_entry_id`, `order_fact_id null`, `entry_date`, `expected_payment_date`, `type` enum(`commission`,`payment_fee`,`delivery`,`promotion`,`subsidy`,`refund`,`cancellation`,`anticipation`,`adjustment`,`payout`,`other`), `raw_type`, `amount_cents`, `import_run_id` | Every credit and debit. Unique (`channel_store_id`,`external_entry_id`) |
| `contract_terms` | `account_id`, `channel_store_id`, `plan_name`, `commission_pct`, `payment_fee_pct`, `delivery_model`, `valid_from`, `valid_to` | Input for expected payout rules (REP-xx) |
| `campaign` | `account_id`, `channel_store_id`, `name`, `discount_pct`, `channel_share_pct`, `starts_on`, `ends_on` | Co-funded promotions (DIF-03) |
| `close_period` | `account_id`, `kitchen_id null`, `month` (date, first day), `status` enum(`open`,`computed`,`delivered`), `computed_at`, `pdf_path`, `xlsx_path` | Fechamento |
| `close_line` | `close_period_id`, `channel_store_id`, `gross_cents`, `commission_cents`, `payment_cents`, `delivery_cents`, `promotion_cents`, `anticipation_cents`, `payout_cents` | C08, P06, W01 |
| `difference` | `account_id`, `close_period_id`, `channel_store_id`, `rule_id` (DIF-xx), `description`, `orders_count`, `amount_cents`, `confidence` enum(`certa`,`provavel`,`duvidosa`), `evidence_path` | C09 |
| `contestation` | `account_id`, `difference_id`, `status` enum(`a_contestar`,`precisa_resposta`,`contestada`,`creditada`,`negada`,`prazo_vencido`), `deadline_on`, `protocol`, `claim_text`, `marked_by`, `marked_at`, `credited_entry_id null` | D30. Status rules in 04-rules |

## 4. M3. Cost and contribution

| Table | Key columns | Notes |
|---|---|---|
| `invoice` | `account_id`, `company_id`, `access_key` (44 digits, unique per account: `unique (account_id, access_key)`, 31/out), `model` (55, 65), `issuer_cnpj`, `issuer_name`, `issued_at`, `total_cents`, `source` enum(`xml_zip`,`key_typed`,`qr_url`,`whatsapp_photo`), `xml_path` | Dedupe by `access_key` within the account (D11); another account's invoices are never revealed |
| `invoice_line` | `invoice_id`, `description`, `ncm`, `gtin`, `unit`, `qty`, `unit_price_cents`, `total_cents` | |
| `ingredient` | `name`, `category`, `base_unit` (g, ml, un), `gtin text[]` | Global catalog, shared across clients (the asset, D14). No `account_id` |
| `ingredient_match` | `invoice_line_id`, `ingredient_id`, `method` enum(`gtin`,`rule`,`ai`,`manual`), `status` enum(`suggested`,`confirmed`,`rejected`), `confirmed_by`, `conversion_factor` | AI suggestions never count until `confirmed` (D14) |
| `ingredient_price` | `account_id`, `ingredient_id`, `price_per_base_unit_cents numeric`, `observed_on`, `source` enum(`invoice`,`regional_prior`) , `invoice_line_id null` | CST-01, CST-02 |
| `menu_item` | `account_id`, `brand_id`, `name`, `channel_item_ids jsonb`, `is_top20 bool` | Shared by M1 and M3 |
| `recipe` | `account_id`, `menu_item_id`, `status` enum(`draft`,`ready`), `built_by`, `built_on` | Ficha técnica (D15) |
| `recipe_line` | `recipe_id`, `ingredient_id`, `qty_base_units numeric`, `yield_pct numeric`, `yield_confidence` enum(`medido`,`declarado`,`estimado`) | |
| `packaging_cost` | `account_id`, `menu_item_id`, `channel`, `cost_cents` | |
| `contribution` | `account_id`, `close_period_id`, `menu_item_id`, `channel`, `price_cents`, `channel_take_cents`, `ingredient_cents`, `ingredient_error_pct`, `left_cents`, `left_pct` | C13, P06 |

## 5. Account, billing, flags, notices

| Table | Key columns | Notes |
|---|---|---|
| `plan` | `code` (`raio_x`,`lucro`,`rede`), `name`, `price_cents null`, `billing_unit` enum(`kitchen`,`channel_store`), `trial_days`, `competitor_xrays_per_month int` (Raio-X 0, Lucro 3, Rede 10; 31/out), `features jsonb` | Prices, trial and the competitor X-ray limit are data, edited in C15 (D40) |
| `subscription` | `account_id`, `plan_id`, `status` enum(`trial`,`active`,`past_due`,`canceled`,`free`), `asaas_customer_id`, `asaas_subscription_id`, `next_due_on`, `units_billed`, `last_event`, `last_event_at` | Status only from Asaas webhooks (D27) |
| `billing_event` | `account_id`, `asaas_event`, `payload jsonb`, `received_at`, `processed_at` | Raw webhooks, idempotent by Asaas event id |
| `pilot` | `account_id`, `pct_months_1_2`, `cap_cents`, `fixed_from_day_61_cents`, `started_on` | D37. Per account, values open |
| `pilot_charge` | `pilot_id`, `month`, `credited_cents`, `charge_cents`, `asaas_payment_id`, `status` | Computed from creditada contestations (C16) |
| `bpo_partner` | `name`, `folder_url`, `logo_path`, `primary_color`, `show_powered_by bool`, `price_per_store_cents null` | C18 |
| `bpo_client` | `bpo_partner_id`, `account_id` | |
| `feature_flag` | `key` (e.g. `m2.ifood_api`), `description`, `default_raio_x bool`, `default_lucro bool`, `default_rede bool`, `env` enum(`sandbox`,`production`) | D34. One row per key and env |
| `feature_override` | `flag_key`, `env`, `account_id`, `value bool`, `reason`, `set_by` | Exceptions |
| `feature_flag_log` | `flag_key`, `env`, `account_id null`, `old`, `new`, `by`, `at` | Every change |
| `notice_type` | `code`, `name`, `audience_roles text[]`, `email_locked bool`, `default_email bool`, `default_whatsapp bool` | The 10 notices of W08 |
| `notice_pref` | `person_id`, `account_id`, `notice_code`, `email bool`, `whatsapp bool` | P16, W08 |
| `notification` | `account_id null`, `person_id null`, `notice_code`, `channel` enum(`email`,`whatsapp`,`whatsapp_manual`), `subject`, `body`, `status` enum(`queued`,`sent`,`failed`,`held_quiet_hours`), `sent_at`, `provider_id` | Outbox. Dev provider writes to a local inbox (D40) |
| `alert` | `severity` enum(`urgente`,`medio`,`baixo`), `title`, `account_id null`, `link`, `notified_via`, `opened_at`, `resolved_at`, `resolved_by` | C21 |
| `audit_log` | `actor_person_id null`, `actor_kind` enum(`person`,`staff`,`system`), `account_id null`, `action`, `entity`, `entity_id`, `before jsonb`, `after jsonb`, `ip`, `user_agent`, `at` | Every write |
| `job` | `type`, `payload jsonb`, `account_id null`, `dedupe_key`, `status` enum(`queued`,`running`,`done`,`failed`), `attempts`, `claimed_at`, `finished_at`, `log jsonb` | Queue (02-architecture §4) |
| `extension_token` | `person_id`, `account_id`, `token_hash`, `created_at`, `last_used_at`, `revoked_at` | Extension auth |

## 6. Seed

`supabase/seed/g_syn.sql` creates the synthetic group used by every screen and test, matching the fictitious numbers drawn in `design/` (Grupo Exemplo with 2 CNPJs, 3 kitchens, 7 channel stores; Pantanos Burguer test store; September 2026 close). `account.is_synthetic = true`, and every PDF or e-mail rendered from it carries the label `SINTÉTICO` (D46).
