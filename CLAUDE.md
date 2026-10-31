# CLAUDE.md, MargoAI

You are building MargoAI from the spec in `spec/`. Read `spec/01-product.md` and `spec/08-build-plan.md` first, then the files the current task names. The screens in `design/` and `spec/05-screens.md` are one thing: build what is drawn, behave as specified.

## Hard rules (never break, never work around)

1. **No secrets.** Do not read, print or create any `.env*` file with real values. Do not run `vercel env`, `maritime` secret or env commands, `supabase link`, or anything that fetches credentials. Local development uses the Supabase local stack only.
2. **No real restaurant data.** Work only with the `G-SYN` seed and files in `fixtures/`. Never call the preview or production database.
3. **No live external calls.** iFood, Asaas, Anthropic, e-mail, Maritime: tests replay recorded fixtures. If a task needs a live call, stop and ask Marlon to run it.
4. **Push only plain fast-forward pushes** of `main` and working branches to `origin` (Marlon authorized this on 31/out). No force push, no branch deletion, no history rewrites. Commit with clear messages.
5. **No automation of logged-in portal sessions, no captcha circumvention, no password handling for restaurants.** The extension acts only on the page the owner opened.
6. **No certificate (A1) custody.**
7. Do not edit `docs/decisions.md` or anything in `design/`. If the spec is ambiguous or contradicts a decision, stop and ask.

## Conventions

- TypeScript (Next.js App Router) in `apps/web` and `extension/`; Python 3.12 with `uv` in `workers/`.
- The SQL migrations in `supabase/migrations/` are the contract. Change the schema only through a new migration, then regenerate types (`pnpm db:types`) and Pydantic models (`uv run gen-models`).
- Money as integer centavos (`_cents`); dates in `America/Sao_Paulo`.
- Every number on screen traces to a rule ID in `spec/04-rules.md`; put the ID in the function name or docstring.
- Every write by a person writes `audit_log`. Every permission check is server-side.
- Feature flags gate screens and jobs (`spec/04-rules.md` §6).
- UI copy in Brazilian Portuguese, verbatim from the drawings; code and comments in English.
- **No em dashes** (the long dash) in any product text, PDF, e-mail or message. Use commas, colons or periods.
- Components use design tokens from `apps/web/app/tokens.css`; no raw hex values.
- Tests first; acceptance row IDs from `spec/07-acceptance.md` in test names.

## Commands

- `pnpm i && uv sync` install
- `supabase start` local database; `pnpm db:reset` migrations plus `G-SYN` seed
- `pnpm dev` web on localhost; `uv run worker <type> --local` run a worker against the local queue
- `pnpm check` lint, types, unit tests, `scripts/check_screens.py`, `scripts/secret_scan.py`
- `pnpm e2e` Playwright against local; `pnpm e2e:screens` screenshots for comparison with `design/`

## When you finish a task

Summarize: files changed, acceptance rows now passing, what needs Marlon (live call, decision). Keep it short.
