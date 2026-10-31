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
