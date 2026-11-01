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
