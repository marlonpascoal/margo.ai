# AI API recordings (06 §6, D14, D40, D70)

Every AI use goes through `margo_common.llm`: OpenAI by default (D70, Marlon 08/nov), Anthropic as an option for a
benchmark. Unit tests never call an API and never replay invented answers: they use fake clients. This folder holds
answers recorded from real calls, made by Marlon. Each file carries `provider`, `request` (no key) and `response`
as the SDK returned it, and is named `<use>-<provider>-<date>.json`. Check each file before committing it.

## Environment (Maritime, or the local workers)

- `MARGO_AI_PROVIDER`: `openai` (default) or `anthropic`.
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`: the provider's key, read by name; never logged or stored. Without it,
  each AI step is skipped with a note and the rules alone decide.
- Model per use, optional: `MARGO_MATCH_MODEL`, `MARGO_PAIR_MODEL`, `MARGO_REVIEW_MODEL`, `MARGO_FAMILY_MODEL`, `MARGO_OPPORTUNITIES_MODEL`. Defaults:
  `gpt-6.1-sol` (OpenAI), `claude-sonnet-5-5` (Anthropic).

## Record

From the repository root, with the key in the environment only for the command:

    OPENAI_API_KEY=... uv run record-ai-opportunities                # P23 "Oportunidades"
    OPENAI_API_KEY=... uv run record-ai-pairing                      # M1-04 Stage 2 attributes
    OPENAI_API_KEY=... uv run record-ai                              # worker-match (D14)
    OPENAI_API_KEY=... uv run record-ai-opportunities <model-id>     # another model
    MARGO_AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... uv run record-ai-opportunities
    OPENAI_API_KEY=... uv run record-ai-opportunities --all          # P23, every SINTÉTICO scenario
    uv run score-ai-opportunities                                    # score the P23 recordings, offline

`record-ai-opportunities --all` sends the six runs in `margo_collector.opportunity_eval.SCENARIOS` (base, many
items below, most above, few stores, spread portions, beverages slightly above) and writes
`opportunities-<provider>-<scenario>-<date>.json` with the prompt version. `score-ai-opportunities` scores each one:
the check's pass rate, the levers used, and the rules the check does not enforce (3 to 5 answers, title and why
length, the caveat on weak comparisons, "pode vender menos" on a raise, the cost on `rever_custo`, no item twice).

What each one sends, through the same request builder the worker uses:

- `record-ai`: three synthetic G-SYN invoice lines (supplier name, description, NCM, unit, unit price in reais) and
  four catalog names. No restaurant, CNPJ, CPF or person; an individual supplier (CPF issuer) goes with no name.
- `record-ai-pairing`: four SINTÉTICO menu items (name, description, category; no store, no price).
- `record-ai-opportunities`: the facts of one SINTÉTICO run (item names, categories, prices in reais and counts; no
  store name, no person).

## What each use does with the answer

- **worker-match (D14):** a suggestion with a confidence, stored as `suggested`; it counts in no cost until a founder
  confirms it in C11 (D02).
- **M1-04 Stage 2 (`xray_pair`):** attributes of the lanches and porções the rules cannot read, one call per X-ray.
  Logs `m1_attr_ai_call`; without a key, `m1_attr_ai_skipped` and nothing is learned.
- **P23 "Oportunidades" (`xray_opportunities`):** 3 to 5 opportunities, once per own run, flag `m1.oportunidades_ia`.
  A deterministic check keeps only those whose numbers all exist in the run's facts, with no "lucro", "margem",
  "ganho" or long dash. Without a key the job finishes done with `skipped_no_key` and no row.

## Pair review (M1-12, D73)

Marlon records the labeled SINTÉTICO pairs; agents never do. The score runs offline.

```bash
OPENAI_API_KEY=... uv run record-ai-pair-review
```

```bash
uv run score-ai-pair-review
```
