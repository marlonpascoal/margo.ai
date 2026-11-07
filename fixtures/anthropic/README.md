# Claude API recordings (06 §6, D14, D40)

worker-match asks the Claude API for an ingredient suggestion only for invoice lines that GTIN and rules
did not match. Unit tests never call the API and never replay invented answers: they use a fake
`Suggester` (`workers/match/tests`). This folder holds answers recorded from real calls, made by Marlon.

## Record

From the repository root, with the key in the environment only for this command:

    ANTHROPIC_API_KEY=... uv run record-anthropic                # default model claude-sonnet-5-5
    ANTHROPIC_API_KEY=... uv run record-anthropic <model-id>     # another model

It sends three synthetic G-SYN lines (supplier name, description, NCM, unit, unit price in reais) and four
catalog names through the same `build_request` the worker uses, and writes `match-<date>.json` here with the
request and the SDK's response. No restaurant, CNPJ, CPF or person is sent; a supplier that is an individual
(CPF issuer) goes with no name (06 §6, D14). Check the file before committing it.

## Environment (worker-match on Maritime)

- `ANTHROPIC_API_KEY`: read by the SDK by name; never logged or stored.
- `MARGO_MATCH_MODEL`: optional, overrides the default model `claude-sonnet-5-5`.

## M1-04 Stage 2: attributes of lanches and porções (worker-collector)

`xray_pair` asks the Claude API, in one structured-output call per X-ray, for the attributes of the lanches and
porções the rules cannot read (`margo_collector.ai_attrs`). Tests use a fake reader and replay every
`pairing-*.json` recorded here; none is invented. To record one real batch, from the repository root:

    ANTHROPIC_API_KEY=... uv run record-anthropic-pairing                # default model claude-sonnet-5-5
    ANTHROPIC_API_KEY=... uv run record-anthropic-pairing <model-id>     # another model

It sends four SINTÉTICO items (name, description, category; no store, no price) through the same `build_request`
the worker uses and writes `pairing-<date>.json` with the request and the SDK's response. Check the file before
committing it.

- `MARGO_PAIR_MODEL`: optional, overrides the default model `claude-sonnet-5-5` in worker-collector.
- Without `ANTHROPIC_API_KEY` the step is skipped with a note (`m1_attr_ai_skipped`), nothing is learned, and the
  pairing is the rules alone. Each call logs `m1_attr_ai_call` with the item count and the model.
