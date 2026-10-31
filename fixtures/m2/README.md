# fixtures/m2: synthetic statements of G-SYN (SINTÉTICO)

Everything here is **synthetic** and **not** a real iFood or 99Food layout. 06-integrations and D40 forbid
invented provider responses, and the spec does not give the real column layout of the iFood Partner Portal
reconciliation and sales reports or of the 99Food Excel statement. So the parsers in `workers/import` are
layout-driven: a layout is a `column_mapping` (header names to canonical fields, number and date formats),
and the only layouts shipped are named `gsyn-sintetico-v1`.

| File | What it is |
|---|---|
| `ifood-conciliacao-set2026-SINTETICO.csv` | Grupo Exemplo (G-02), 3 iFood stores, September 2026, layout `gsyn-sintetico-v1` (`;`, decimal comma) |
| `99food-extrato-set2026-SINTETICO-v1.xlsx` | G-02, 2 99Food stores, September 2026, layout `gsyn-sintetico-v1`, 1.022 rows (two payout installments per order) |
| `99food-extrato-set2026-SINTETICO.xlsx` | Same month in a changed layout (3 new columns: "Subsídio da plataforma", "Ajuste CBS/IBS", "Repasse dividido"), the C17 and C02 case |
| `99food-extrato-out2026-SINTETICO.xlsx` | October, changed layout: after C17 maps the layout once, this file imports alone (C02) |
| `generate.py` | Writes all of the above and `supabase/seed/g_syn_m2.sql` from one source |

Each file says `SINTÉTICO` in its first row; the parser finds the header below it. CNPJs never appear (the
stores' CNPJs live in the seed, with invalid check digits).

Regenerate after changing a rule or the layout: `uv run python fixtures/m2/generate.py`. The script asserts
that worker-import's own parser and close reproduce the drawn September numbers of C08, C09, C16 and P06
to the centavo, and writes the seed from what the parser read, so the files, the seed and the code agree.

## What Marlon should drop in

The real layouts arrive as new `column_mapping` rows, through C17, from an anonymized sample:

1. **iFood**: one export of the Partner Portal **reconciliation** report ("conciliação") and one of the
   **sales** report ("vendas", item level if the portal offers it), for any month, as downloaded (CSV or
   XLSX, untouched).
2. **99Food**: one **Excel statement** ("extrato") as downloaded from the 99Food partner portal.
3. Anonymize before the file enters the repository (D20, 07 §1): replace store names with codes, remove
   CNPJs, customer names, addresses and phone numbers; keep every column header, the row structure and the
   values. Name the files `<source>-<report>-<yyyymm>-ANONIMIZADO.<ext>` in `fixtures/m2/real/`.

Then: upload the file in C07 of a synthetic account, map its columns in C17 (the run stays `needs_mapping`
until the payout total of the file matches the mapped total), and add the saved mapping to the seed under
its real name. Two layout shapes may need parser work rather than a mapping: a long reconciliation file (one
row per financial event, with the event type in a column) and a file whose order values are split across
installment rows. The synthetic layouts are wide (one row per order or installment).
